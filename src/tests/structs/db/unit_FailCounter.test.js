process.env.TEST_ENV = true
const FailCounter = require('../../../structs/db/FailCounter.js')

describe('Unit::structs/db/FailCounter', function () {
  afterEach(function () {
    jest.restoreAllMocks()
  })
  describe('constructor', function () {
    it('initializes default values', function () {
      const data = {
        url: 'aesdgdf'
      }
      const counter = new FailCounter(data)
      expect(counter.count).toEqual(0)
      expect(counter.reason).toBeUndefined()
    })
    it('initializes with given values', function () {
      const data = {
        url: 'aesdgdf',
        count: 99,
        reason: 'helaz'
      }
      const counter = new FailCounter(data)
      expect(counter.url).toEqual(data.url)
      expect(counter.count).toEqual(data.count)
      expect(counter.reason).toEqual(data.reason)
    })
  })
  describe('static increment', function () {
    it('finds the right model', async function () {
      const spy = jest.spyOn(FailCounter, 'getBy').mockResolvedValue({
        increment: jest.fn()
      })
      const url = 'srfyhed'
      await FailCounter.increment(url)
      expect(spy).toHaveBeenCalledWith('url', url)
    })
    it('increments the model if it exists', async function () {
      const found = {
        increment: jest.fn()
      }
      jest.spyOn(FailCounter, 'getBy').mockResolvedValue(found)
      const reason = 'ewstr4ydh'
      await FailCounter.increment('sdfgtgh', reason)
      expect(found.increment).toHaveBeenCalledWith(reason)
    })
  })
  describe('static reset', function () {
    it('finds the right model', async function () {
      const spy = jest.spyOn(FailCounter, 'getBy').mockResolvedValue({
        delete: jest.fn()
      })
      const url = 'srfyhed'
      await FailCounter.reset(url)
      expect(spy).toHaveBeenCalledWith('url', url)
    })
    it('deletes the found model', async function () {
      const found = {
        delete: jest.fn()
      }
      jest.spyOn(FailCounter, 'getBy').mockResolvedValue(found)
      const url = 'srfyhed'
      await FailCounter.reset(url)
      expect(found.delete).toHaveBeenCalled()
    })
  })
  describe('static hasFailed', function () {
    it('returns false if getBy returns null', async function () {
      jest.spyOn(FailCounter, 'getBy').mockResolvedValue(null)
      const returned = await FailCounter.hasFailed()
      expect(returned).toEqual(false)
    })
    it('return the value of protoype.hasFailed if found', async function () {
      const hasFailed = jest.fn(() => true)
      const found = {
        hasFailed
      }
      jest.spyOn(FailCounter, 'getBy').mockResolvedValue(found)
      await expect(FailCounter.hasFailed())
        .resolves.toEqual(true)
      hasFailed.mockReturnValue(false)
      await expect(FailCounter.hasFailed())
        .resolves.toEqual(false)
    })
  })
  describe('hasFailed', function () {
    const limit = 2
    beforeEach(function () {
      jest.spyOn(FailCounter, 'limit', 'get').mockReturnValue(limit)
    })
    it('returns false if limit is 0', function () {
      jest.spyOn(FailCounter, 'limit', 'get').mockReturnValue(0)
      const data = {
        url: 'sg'
      }
      const counter = new FailCounter(data)
      counter.count = limit + 1
      expect(counter.hasFailed()).toEqual(false)
    })
    it('returns false if count is below limit', function () {
      const data = {
        url: 'sg'
      }
      const counter = new FailCounter(data)
      counter.count = limit - 1
      expect(counter.hasFailed()).toEqual(false)
    })
    it('returns true if count at or above limit', function () {
      const data = {
        url: 'sg'
      }
      const counter = new FailCounter(data)
      counter.count = limit
      expect(counter.hasFailed()).toEqual(true)
      counter.count = limit + 1
      expect(counter.hasFailed()).toEqual(true)
    })
  })
  describe('fail', function () {
    it('sets this.reason to the new reason', async function () {
      const data = {
        url: 'w234etr'
      }
      const counter = new FailCounter(data)
      jest.spyOn(counter, 'save').mockResolvedValue()
      const reason = 'wse4ry57h'
      await counter.fail(reason)
      expect(counter.reason).toEqual(reason)
    })
    it('calls save when reason does not exist', async function () {
      const data = {
        url: 'w234etr'
      }
      const counter = new FailCounter(data)
      const spy = jest.spyOn(counter, 'save').mockResolvedValue()
      const reason = 'wse4ry57h'
      await counter.fail(reason)
      expect(spy).toHaveBeenCalledTimes(1)
    })
    it('calls save when reason is different from the current one', async function () {
      const data = {
        url: 'w234etr'
      }
      const counter = new FailCounter(data)
      const reason = 'wse4ry57h'
      counter.reason = reason + 'w34re56y7tuh'
      const spy = jest.spyOn(counter, 'save').mockResolvedValue()
      await counter.fail(reason)
      expect(spy).toHaveBeenCalledTimes(1)
    })
    it('does not call save when reason is same as current one', async function () {
      const data = {
        url: 'w234etr'
      }
      const counter = new FailCounter(data)
      counter.failedAt = 'w4rey'
      const reason = 'wse4ry57h'
      counter.reason = reason
      const spy = jest.spyOn(counter, 'save').mockResolvedValue()
      await counter.fail(reason)
      expect(spy).not.toHaveBeenCalled()
    })
    it('saves the current date to failedAt', async function () {
      const data = {
        url: 'aeswtry4'
      }
      const counter = new FailCounter(data)
      expect(counter.failedAt).toBeUndefined()
      jest.spyOn(counter, 'save').mockResolvedValue()
      await counter.fail('my reason')
      expect(counter.failedAt).toBeDefined()
    })
    it('saves for a new failedAt if there is none', async function () {
      const data = {
        url: 'aeswtry4'
      }
      const counter = new FailCounter(data)
      const reason = '3w24tery5t'
      counter.reason = reason
      expect(counter.failedAt).toBeUndefined()
      const spy = jest.spyOn(counter, 'save').mockResolvedValue()
      await counter.fail(reason)
      expect(spy).toHaveBeenCalledTimes(1)
    })
    it('does not overwrite previous failedAt date for another fail call', async function () {
      const data = {
        url: 'aeswtry4'
      }
      const counter = new FailCounter(data)
      jest.spyOn(counter, 'save').mockResolvedValue()
      await counter.fail('my reason')
      const currentFailedAt = counter.failedAt
      await counter.fail('dseghfrntg')
      expect(counter.failedAt).toEqual(currentFailedAt)
    })
    it('sets the count to the fail limit', async function () {
      const data = {
        url: 'aged'
      }
      const limit = 1004
      jest.spyOn(FailCounter, 'limit', 'get').mockReturnValue(limit)
      const counter = new FailCounter(data)
      jest.spyOn(counter, 'save').mockResolvedValue()
      await counter.fail('my reason')
      expect(counter.count).toEqual(limit)
    })
    it('saves if the count is not at fail limit', async function () {
      const data = {
        url: 'aged'
      }
      const limit = 1004
      const reason = 'qw4et6r'
      jest.spyOn(FailCounter, 'limit', 'get').mockReturnValue(limit)
      const counter = new FailCounter(data)
      counter.failedAt = 'w43re5yt'
      counter.reason = reason
      const spy = jest.spyOn(counter, 'save').mockResolvedValue()
      await counter.fail(reason)
      expect(spy).toHaveBeenCalledTimes(1)
    })
    it('does not call save if nothing needs to be updated', async function () {
      const data = {
        url: 'aged'
      }
      const limit = 1004
      const reason = 'qw4et6r'
      jest.spyOn(FailCounter, 'limit', 'get').mockReturnValue(limit)
      const counter = new FailCounter(data)
      counter.failedAt = 'w43re5yt'
      counter.reason = reason
      counter.count = limit
      const spy = jest.spyOn(counter, 'save').mockResolvedValue()
      await counter.fail(reason)
      expect(spy).not.toHaveBeenCalled()
    })
  })
  describe('increment', function () {
    it('calls fail if it reached the threshold', async function () {
      const data = {
        url: 'esd'
      }
      const counter = new FailCounter(data)
      jest.spyOn(counter, 'hasFailed').mockReturnValue(true)
      const spy = jest.spyOn(counter, 'fail').mockResolvedValue()
      const reason = 'wset4ry5t'
      await counter.increment(reason)
      expect(spy).toHaveBeenCalledWith(reason)
    })
    it('increments counter', async function () {
      const data = {
        url: 'esd'
      }
      const counter = new FailCounter(data)
      counter.count = 0
      jest.spyOn(counter, 'hasFailed').mockReturnValue(false)
      jest.spyOn(counter, 'save').mockResolvedValue()
      await counter.increment()
      expect(counter.count).toEqual(1)
    })
    it('calls save if it has not failed yet', async function () {
      const data = {
        url: 'esd'
      }
      const counter = new FailCounter(data)
      jest.spyOn(counter, 'hasFailed').mockReturnValue(false)
      const spy = jest.spyOn(counter, 'save').mockResolvedValue()
      await counter.increment()
      expect(spy).toHaveBeenCalledTimes(1)
    })
  })
  describe('toObject', function () {
    it('returns correctly', function () {
      const data = {
        url: 'aetgswr'
      }
      const counter = new FailCounter(data)
      const url = 'w49y6huie'
      const count = 1111
      const reason = 'jackzzz'
      const failedAt = 'q3w24t6ery5tu6'
      counter.url = url
      counter.count = count
      counter.reason = reason
      counter.failedAt = failedAt
      const returned = counter.toObject()
      expect(returned).toEqual({
        url,
        count,
        reason,
        failedAt
      })
    })
  })
})
