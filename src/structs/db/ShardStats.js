const Base = require('./Base.js')
const ShardStatsModel = require('../../models/ShardStats.js').model

class ShardStats extends Base {
  constructor (data, _saved) {
    super(data, _saved)

    if (!this._id) {
      throw new Error('Undefined _id')
    }

    /**
     * Number of feeds on this shard
     * @type {number}
     */
    this.feeds = this.getField('feeds', 0)

    /**
     * Average cycle time of default schedule
     * @type {number}
     */
    this.cycleTime = this.getField('cycleTime', 0)

    /**
     * Average number of failures of default schedule
     * @type {number}
     */
    this.cycleFails = this.getField('cycleFails', 0)

    /**
     * Number of unique feed URLs in default schedule
     * @type {number}
     */
    this.cycleURLs = this.getField('cycleURLs', 0)

    /**
     * ISO Date string
     * @type {string}
     */
    this.lastUpdated = this.getField('lastUpdated', 'N/A')
  }

  toObject () {
    return {
      _id: this._id,
      feeds: this.feeds,
      cycleTime: this.cycleTime,
      cycleFails: this.cycleFails,
      cycleURLs: this.cycleURLs,
      lastUpdated: this.lastUpdated
    }
  }

  static get Model () {
    return ShardStatsModel
  }
}

module.exports = ShardStats
