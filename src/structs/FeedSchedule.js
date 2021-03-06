const path = require('path')
const getArticles = require('../rss/singleMethod.js')
const config = require('../config.js')
const Schedule = require('./db/Schedule.js')
const Profile = require('./db/Profile.js')
const FailCounter = require('./db/FailCounter.js')
const Subscriber = require('./db/Subscriber.js')
const Format = require('./db/Format.js')
const FilteredFormat = require('./db/FilteredFormat.js')
const ShardStats = require('./db/ShardStats.js')
const Feed = require('./db/Feed.js')
const Supporter = require('./db/Supporter.js')
const debug = require('../util/debugFeeds.js')
const EventEmitter = require('events')
const childProcess = require('child_process')
const maintenance = require('../util/maintenance/index.js')
const log = require('../util/logger.js')

const BATCH_SIZE = config.advanced.batchSize

class FeedSchedule extends EventEmitter {
  /**
   * @param {import('discord.js').Client} bot
   * @param {Object<string, any>} schedule
   * @param {import('./ScheduleManager.js')} scheduleManager
   */
  constructor (bot, schedule, scheduleManager) {
    if (!schedule.refreshRateMinutes) {
      throw new Error('No refreshRateMinutes has been declared for a schedule')
    }
    if (schedule.name !== 'default' && schedule.name !== Supporter.schedule.name && schedule.keywords.length === 0 && schedule.feeds.length === 0) {
      throw new Error(`Cannot create a FeedSchedule with invalid/empty keywords array for nondefault schedule (name: ${schedule.name})`)
    }
    super()
    this.shardID = scheduleManager.shardID
    this.SHARD_ID = 'SH ' + this.shardID + ' '
    this.bot = bot
    this.name = schedule.name
    this.scheduleManager = scheduleManager
    this.keywords = schedule.keywords
    this.rssNames = schedule.feeds
    this.refreshRate = schedule.refreshRateMinutes
    this._linksResponded = {}
    this._processorList = []
    this._regBatchList = []
    this._modBatchList = [] // Batch of sources with cookies
    this._cycleFailCount = 0
    this._cycleTotalCount = 0
    this._sourceList = new Map()
    this._modSourceList = new Map()
    this._profilesById = new Map()
    this._formatsByFeedId = new Map()
    this._filteredFormatsByFeedId = new Map()
    this._subscribersByFeedId = new Map()
    this.feedData = config.database.uri.startsWith('mongo') ? undefined : {} // ONLY FOR DATABASELESS USE. Object of collection ids as keys, and arrays of objects (AKA articles) as values
    this.feedCount = 0 // For statistics
    this.failCounters = {}
    this.ran = 0 // # of times this schedule has ran
    this.headers = {}
    this.debugFeedLinks = new Set()

    // For vip tracking
    this.vipServerLimits = {}
    this.allowWebhooks = new Map()
  }

  /**
   * @param {Feed} feed
   */
  _delegateFeed (feed) {
    // The guild id and date settings are needed after it is sent to the child process, and sent back for any ArticleMessages to access
    const guild = this._profilesById.get(feed.guild)
    const format = this._formatsByFeedId.get(feed._id)
    const subscribers = this._subscribersByFeedId.get(feed._id) || []
    const filteredFormats = this._filteredFormatsByFeedId.get(feed._id) || []
    const data = {
      ...feed.toJSON(),
      subscribers,
      format,
      filteredFormats,
      dateSettings: !guild
        ? {}
        : {
          timezone: guild.timezone,
          format: guild.dateFormat,
          language: guild.dateLanguage
        }
    }

    if (Supporter.enabled && !this.allowWebhooks.has(feed.guild) && feed.webhook) {
      // log.cycle.warning(`Illegal webhook found for guild ${guildRss.id} for source ${rssName}`)
      feed.webhook = undefined
    }

    if (this._sourceList.has(feed.url)) { // Each item in the this._sourceList has a unique URL, with every source with this the same link aggregated below it
      let linkList = this._sourceList.get(feed.url)
      linkList[feed._id] = data
      if (debug.feeds.has(feed._id)) {
        log.debug.info(`${feed._id}: Adding to pre-existing source list`)
      }
    } else {
      let linkList = {}
      linkList[feed._id] = data
      this._sourceList.set(feed.url, linkList)
      if (debug.feeds.has(feed._id)) {
        log.debug.info(`${feed._id}: Creating new source list`)
      }
    }
  }

  /**
   * @param {Feed} feed
   */
  _addToSourceLists (feed) { // rssList is an object per guildRss
    const toDebug = debug.feeds.has(feed._id)
    const hasGuild = this.bot.guilds.has(feed.guild)
    const hasChannel = this.bot.channels.has(feed.channel)
    if (!hasGuild || !hasChannel) {
      if (debug.feeds.has(feed._id)) {
        log.debug.info(`${feed._id}: Not processing feed since it has missing guild (${hasGuild}) or channel (${hasChannel}), assigned to schedule ${this.name} on ${this.SHARD_ID}`)
      }
      return false
    }

    // if (!this.feedIDs.has(feed._id)) {
    //   if (debug.feeds.has(feed._id)) {
    //     log.debug.info(`${feed._id}: Not processing feed since it is not assigned to schedule ${this.name} on ${this.SHARD_ID}`)
    //   }
    //   return false
    // }

    const failCounter = this.failCounters[feed.url]
    if (failCounter && failCounter.hasFailed()) {
      if (toDebug) {
        log.debug.info(`${feed._id}: Skipping feed delegation due to failed status: ${failCounter.hasFailed()}`)
      }
      return false
    }

    const format = this._formatsByFeedId.get(feed._id)
    const disabled = maintenance.checkPermissions(feed, format, this.bot)
    if (disabled) {
      if (toDebug) {
        log.debug.info(`${feed._id}: Skipping feed delegation due to disabled status: ${failCounter.hasFailed()}`)
      }
      return false
    }

    if (toDebug) {
      log.debug.info(`${feed._id}: Preparing for feed delegation`)
      this.debugFeedLinks.add(feed.url)
    }

    this._delegateFeed(feed)

    if (config.dev === true) {
      return true
    }
    // for (var channelId in status) {
    //   let m = '**ATTENTION** - The following changes have been made due to a feed limit change for this server:\n\n'
    //   const enabled = status[channelId].enabled
    //   const disabled = status[channelId].disabled
    //   if (enabled.length === 0 && disabled.length === 0) continue
    //   for (var a = 0; a < enabled.length; ++a) m += `Feed <${enabled[a]}> has been enabled.\n`
    //   for (var b = 0; b < disabled.length; ++b) m += `Feed <${disabled[b]}> has been disabled.\n`
    //   const channel = this.bot.channels.get(channelId)
    //   if (channel) {
    //     channel.send(m)
    //       .then(m => log.general.info(`Sent feed enable/disable notice to server`, channel.guild, channel))
    //       .catch(err => log.general.warning('Unable to send feed enable/disable notice', channel.guild, channel, err))
    //   }
    // }
    return true
  }

  _genBatchLists () {
    let batch = {}

    this._sourceList.forEach((rssList, link) => { // rssList per link
      if (Object.keys(batch).length >= BATCH_SIZE) {
        this._regBatchList.push(batch)
        batch = {}
      }
      batch[link] = rssList
      if (debug.links.has(link)) {
        log.debug.info(`${link}: Attached URL to regular batch list for ${this.name} on ${this.SHARD_ID}`)
      }
      this._linksResponded[link] = 1
    })

    if (Object.keys(batch).length > 0) this._regBatchList.push(batch)

    batch = {}

    this._modSourceList.forEach((source, link) => { // One RSS source per link instead of an rssList
      if (Object.keys(batch).length >= BATCH_SIZE) {
        this._modBatchList.push(batch)
        batch = {}
      }
      batch[link] = source
      if (debug.links.has(link)) {
        log.debug.info(`${link}: Attached URL to modded batch list for ${this.name} on ${this.SHARD_ID}`)
      }
      if (!this._linksResponded[link]) this._linksResponded = 1
      else ++this._linksResponded[link]
    })

    if (Object.keys(batch).length > 0) this._modBatchList.push(batch)
  }

  async run () {
    if (this.inProgress) {
      if (!config.advanced.forkBatches) {
        log.cycle.warning(`Previous ${this.name === 'default' ? 'default ' : ''}feed retrieval cycle${this.name !== 'default' ? ' (' + this.name + ') ' : ''} was unable to finish, attempting to start new cycle. If repeatedly seeing this message, consider increasing your refresh time.`)
        this.inProgress = false
      } else {
        let list = ''
        let c = 0
        for (const link in this._linksResponded) {
          if (this._linksResponded[link] === 0) continue
          FailCounter.increment(link, 'Failed to respond in a timely manner')
            .catch(err => log.cycle.warning(`Unable to increment fail counter for ${link}`, err))
          list += `${link}\n`
          ++c
        }
        if (c > 25) list = 'Greater than 25 links, skipping log'
        log.cycle.warning(`${this.SHARD_ID}Schedule ${this.name} - Processors from previous cycle were not killed (${this._processorList.length}). Killing all processors now. If repeatedly seeing this message, consider increasing your refresh time. The following links (${c}) failed to respond:`)
        console.log(list)
        for (var x in this._processorList) {
          this._processorList[x].kill()
        }
        this._processorList = []
      }
    }

    this.debugFeedLinks.clear()
    this.allowWebhooks.clear()
    const supporterLimits = new Map()

    if (Supporter.enabled) {
      const supporters = await Supporter.getValidSupporters()
      for (const supporter of supporters) {
        const [ allowWebhook, maxFeeds ] = await Promise.all([
          supporter.getWebhookAccess(),
          supporter.getMaxFeeds()
        ])
        const guilds = supporter.guilds
        for (const guildId of guilds) {
          if (allowWebhook) {
            this.allowWebhooks.set(guildId, true)
          }
          supporterLimits.set(guildId, maxFeeds)
        }
      }
    }

    this._formatsByFeedId.clear()
    this._filteredFormatsByFeedId.clear()
    this._subscribersByFeedId.clear()
    const [
      failCounters,
      profiles,
      feeds,
      formats,
      filteredFormats,
      subscribers,
      supporterGuilds,
      schedules
    ] = await Promise.all([
      FailCounter.getAll(),
      Profile.getAll(),
      Feed.getAll(),
      Format.getAll(),
      FilteredFormat.getAll(),
      Subscriber.getAll(),
      Supporter.getValidGuilds(),
      Schedule.getAll()
    ])
    await maintenance.checkLimits(feeds, supporterLimits)
    formats.forEach(format => {
      this._formatsByFeedId.set(format.feed, format.toJSON())
    })
    filteredFormats.forEach(format => {
      if (!this._filteredFormatsByFeedId.has(format.feed)) {
        this._filteredFormatsByFeedId.set(format.feed, [format.toJSON()])
      } else {
        this._filteredFormatsByFeedId.get(format.feed).push(format.toJSON())
      }
    })
    profiles.forEach(profile => {
      this._profilesById.set(profile.id, profile)
    })
    subscribers.forEach(subscriber => {
      const feedId = subscriber.feed
      const json = subscriber.toJSON()
      if (!this._subscribersByFeedId.has(feedId)) {
        this._subscribersByFeedId.set(feedId, [json])
      } else {
        this._subscribersByFeedId.get(feedId).push(json)
      }
    })
    this.failCounters = {}
    for (const counter of failCounters) {
      this.failCounters[counter.url] = counter
    }

    this._startTime = new Date()
    this._regBatchList = []
    this._modBatchList = []
    this._cycleFailCount = 0
    this._cycleTotalCount = 0
    this._linksResponded = {}

    this._modSourceList.clear() // Regenerate source lists on every cycle to account for changes to guilds
    this._sourceList.clear()
    let feedCount = 0 // For statistics in storage
    const determinedSchedules = await Promise.all(feeds.map(f => f.determineSchedule(schedules, supporterGuilds)))
    for (let i = 0; i < feeds.length; ++i) {
      const feed = feeds[i]
      const name = determinedSchedules[i].name
      if (this.name !== name) {
        return
      }
      if (debug.feeds.has(feed._id)) {
        log.debug.info(`${feed._id}: Assigned schedule ${this.name} on shard ${this.SHARD_ID}`)
      }
      if (this._addToSourceLists(feed)) {
        feedCount++
      }
    }

    this.inProgress = true
    this.feedCount = feedCount
    this._genBatchLists()

    if (this._sourceList.size + this._modSourceList.size === 0) {
      this.inProgress = false
      return this._finishCycle(true)
    }

    if (config.advanced.forkBatches) this._getBatchParallel()
    else this._getBatch(0, this._regBatchList, 'regular')
  }

  _getBatch (batchNumber, batchList, type) {
    if (batchList.length === 0) return this._getBatch(0, this._modBatchList, 'modded')
    const currentBatch = batchList[batchNumber]
    const currentBatchLen = Object.keys(batchList[batchNumber]).length
    let completedLinks = 0

    for (var link in currentBatch) {
      const rssList = currentBatch[link]
      let uniqueSettings
      for (var modRssName in rssList) {
        if (rssList[modRssName].advanced && Object.keys(rssList[modRssName].advanced).length > 0) {
          uniqueSettings = rssList[modRssName].advanced
        }
      }

      const data = {
        config,
        link,
        rssList,
        uniqueSettings,
        feedData: this.feedData,
        runNum: this.ran,
        scheduleName: this.name,
        shardID: this.shardID
      }

      getArticles(data, (err, linkCompletion) => {
        if (err) log.cycle.warning(`Skipping ${linkCompletion.link}`, err)
        if (linkCompletion.status === 'article') {
          if (debug.feeds.has(linkCompletion.article.rssName)) {
            log.debug.info(`${linkCompletion.article.rssName}: Emitted article event.`)
          }
          return this.emit('article', linkCompletion.article)
        }
        if (linkCompletion.status === 'failed') {
          ++this._cycleFailCount
          FailCounter.increment(linkCompletion.link)
            .catch(err => log.cycle.warning(`Unable to increment fail counter ${linkCompletion.link}`, err))
        } else if (linkCompletion.status === 'success') {
          FailCounter.reset(linkCompletion.link)
            .catch(err => log.cycle.warning(`Unable to reset fail counter ${linkCompletion.link}`, err))
          if (linkCompletion.feedCollectionId) this.feedData[linkCompletion.feedCollectionId] = linkCompletion.feedCollection // Only if config.database.uri is a databaseless folder path
        }

        ++this._cycleTotalCount
        ++completedLinks
        --this._linksResponded[linkCompletion.link]
        if (debug.links.has(linkCompletion.link)) {
          log.debug.info(`${linkCompletion.link} - Link finished in processor on ${this.name} for (${this.SHARD_ID})`)
        }
        if (completedLinks === currentBatchLen) {
          if (batchNumber !== batchList.length - 1) setTimeout(this._getBatch.bind(this), 200, batchNumber + 1, batchList, type)
          else if (type === 'regular' && this._modBatchList.length > 0) setTimeout(this._getBatch.bind(this), 200, 0, this._modBatchList, 'modded')
          else return this._finishCycle()
        }
      })
    }
  }

  _getBatchParallel () {
    const totalBatchLengths = this._regBatchList.length + this._modBatchList.length
    let completedBatches = 0

    let willCompleteBatch = 0
    let regIndices = []
    let modIndices = []

    const deployProcessor = (batchList, index, callback) => {
      if (!batchList) return
      let completedLinks = 0
      const currentBatch = batchList[index]
      const currentBatchLen = Object.keys(currentBatch).length
      this._processorList.push(childProcess.fork(path.join(__dirname, '..', 'rss', 'isolatedMethod.js')))

      const processorIndex = this._processorList.length - 1
      const processor = this._processorList[processorIndex]

      processor.on('message', linkCompletion => {
        if (linkCompletion.status === 'headers') {
          this.headers[linkCompletion.link] = { lastModified: linkCompletion.lastModified, etag: linkCompletion.etag }
          return
        }
        if (linkCompletion.status === 'article') return this.emit('article', linkCompletion.article)
        if (linkCompletion.status === 'batch_connected' && callback) return callback() // Spawn processor for next batch
        if (linkCompletion.status === 'failed') {
          ++this._cycleFailCount
          FailCounter.increment(linkCompletion.link)
            .catch(err => log.cycle.warning(`Unable to increment fail counter ${linkCompletion.link}`, err))
        } else if (linkCompletion.status === 'success') {
          FailCounter.reset(linkCompletion.link)
            .catch(err => log.cycle.warning(`Unable to reset fail counter ${linkCompletion.link}`, err))
          if (linkCompletion.feedCollectionId) this.feedData[linkCompletion.feedCollectionId] = linkCompletion.feedCollection // Only if config.database.uri is a databaseless folder path
        }

        ++this._cycleTotalCount
        ++completedLinks
        --this._linksResponded[linkCompletion.link]
        if (debug.links.has(linkCompletion.link)) {
          log.debug.info(`${linkCompletion.link}: Link responded from processor for ${this.name} on ${this.SHARD_ID}`)
        }
        if (completedLinks === currentBatchLen) {
          completedBatches++
          processor.kill()
          if (completedBatches === totalBatchLengths) {
            this._processorList.length = 0
            this._finishCycle()
          }
        }
      })

      processor.send({
        config,
        currentBatch,
        debugFeeds: debug.feeds.serialize(),
        debugLinks: [ ...debug.links.serialize(), ...this.debugFeedLinks ],
        headers: this.headers,
        feedData: this.feedData,
        runNum: this.ran,
        scheduleName: this.name,
        shardID: this.shardID
      })
    }

    const spawn = (count) => {
      for (var q = 0; q < count; ++q) {
        willCompleteBatch++
        const batchList = regIndices.length > 0 ? this._regBatchList : modIndices.length > 0 ? this._modBatchList : undefined
        const index = regIndices.length > 0 ? regIndices.shift() : modIndices.length > 0 ? modIndices.shift() : undefined
        deployProcessor(batchList, index, () => {
          if (willCompleteBatch < totalBatchLengths) spawn(1)
        })
      }
    }

    if (config.advanced.parallelBatches > 0) {
      for (var g = 0; g < this._regBatchList.length; ++g) regIndices.push(g)
      for (var h = 0; h < this._modBatchList.length; ++h) modIndices.push(h)
      spawn(config.advanced.parallelBatches)
    } else {
      for (var i = 0; i < this._regBatchList.length; ++i) { deployProcessor(this._regBatchList, i) }
      for (var y = 0; y < this._modBatchList.length; ++y) { deployProcessor(this._modBatchList, y) }
    }
  }

  killChildren () {
    for (var x of this._processorList) x.kill()
    this._processorList = []
  }

  _finishCycle (noFeeds) {
    process.send({ _drss: true, type: 'scheduleComplete', refreshRate: this.refreshRate })
    const cycleTime = (new Date() - this._startTime) / 1000
    const timeTaken = cycleTime.toFixed(2)
    ShardStats.get(this.shardID.toString())
      .then(stats => {
        const data = {
          _id: this.shardID.toString(),
          feeds: this.feedCount,
          cycleTime,
          cycleFails: this._cycleFailCount,
          cycleURLs: this._cycleTotalCount,
          lastUpdated: new Date().toISOString()
        }
        if (!stats) {
          stats = new ShardStats(data)
          return stats.save()
        } else {
          stats.feeds = data.feeds
          stats.cycleTime = ((data.cycleTime + stats.cycleTime) / 2).toFixed(2)
          stats.cycleFails = ((data.cycleFails + stats.cycleFails) / 2).toFixed(2)
          stats.cycleURLs = data.cycleURLs
          stats.lastUpdated = data.lastUpdated
          return stats.save()
        }
      }).catch(err => log.general.warning('Unable to update statistics after cycle', err, true))

    if (noFeeds) {
      log.cycle.info(`${this.SHARD_ID}Finished ${this.name === 'default' ? 'default ' : ''}feed retrieval cycle${this.name !== 'default' ? ' (' + this.name + ')' : ''}. No feeds to retrieve`)
    } else {
      if (this._processorList.length === 0) this.inProgress = false
      this.emit('finish')
      log.cycle.info(`${this.SHARD_ID}Finished ${this.name === 'default' ? 'default ' : ''}feed retrieval cycle${this.name !== 'default' ? ' (' + this.name + ')' : ''}${this._cycleFailCount > 0 ? ' (' + this._cycleFailCount + '/' + this._cycleTotalCount + ' failed)' : ''}. Cycle Time: ${timeTaken}s`)
    }

    ++this.ran
  }
}

module.exports = FeedSchedule
