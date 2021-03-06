process.env.TEST_ENV = true
const config = require('../../../config.js')
const Format = require('../../../structs/db/Format.js')
const mongoose = require('mongoose')
require('../../../models/Feed.js')
const dbName = 'test_int_base'
const CON_OPTIONS = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  useCreateIndex: true
}

jest.mock('../../../config.js')

describe('Int::structs/db/Format', function () {
  /** @type {import('mongoose').Collection} */
  let collection
  let feedID = new mongoose.Types.ObjectId()
  beforeAll(async function () {
    config.database.uri = 'mongodb://'
    await mongoose.connect(`mongodb://localhost:27017/${dbName}`, CON_OPTIONS)
    await mongoose.connection.db.dropDatabase()
    collection = mongoose.connection.db.collection('formats')
    await mongoose.connection.db.collection('feeds').insertOne({
      _id: feedID
    })
  })
  describe('pruneEmbeds', function () {
    it('works with fields', function () {
      const embeds = [{
        fields: [{}, {
          name: 'abc'
        }, {
          name: 'foo',
          value: 'bar'
        }]
      }]
      const format = new Format({
        feed: feedID.toHexString(),
        embeds
      })
      format.pruneEmbeds()
      expect(format.embeds).toEqual([{
        fields: [{
          name: 'foo',
          value: 'bar'
        }]
      }])
    })
    it('works with non-field', function () {
      const embeds = [{}, {
        title: 'dodat'
      }, {}]
      const format = new Format({
        feed: feedID.toHexString(),
        embeds
      })
      format.pruneEmbeds()
      expect(format.embeds).toEqual([{
        title: 'dodat'
      }])
    })
  })
  it('does not save embeds with _id', async function () {
    const embeds = [{
      title: 'jack'
    }]
    const data = {
      feed: feedID.toHexString(),
      text: 'no _id',
      embeds
    }
    const format = new Format(data)
    await format.save()
    const result = await collection.findOne({
      text: data.text
    })
    expect(result.embeds[0]).not.toHaveProperty('_id')
  })
  it('does not save embed fields with _id', async function () {
    const embeds = [{
      title: 'jack',
      fields: [{
        name: 'abas',
        value: 'w46ye5t'
      }]
    }]
    const data = {
      feed: feedID.toHexString(),
      text: 'no _id in fields',
      embeds
    }
    const format = new Format(data)
    await format.save()
    const result = await collection.findOne({
      text: data.text
    })
    expect(result.embeds[0].fields[0]).not.toHaveProperty('_id')
  })
  it('does not save filters', async function () {
    const embeds = [{
      title: 'jack',
      fields: [{
        name: 'abas',
        value: 'w46ye5t'
      }]
    }]
    const data = {
      feed: feedID.toHexString(),
      text: 'no _id in fields',
      filters: {
        title: ['hoo ha']
      },
      embeds
    }
    const format = new Format(data)
    await format.save()
    const result = await collection.findOne({
      text: data.text
    })
    expect(result.filters).toBeUndefined()
  })
  afterAll(async function () {
    await mongoose.connection.db.dropDatabase()
    await mongoose.connection.close()
  })
})
