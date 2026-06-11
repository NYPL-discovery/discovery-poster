const assert = require('assert')
const sinon = require('sinon')
const { config } = require('@nypl/node-utils')
const poster = require('../index')

describe('Discovery Bib Poster', () => {
  before(() => {
    sinon.stub(config, 'loadConfig').resolves({
      NYPL_API_POST_URL: 'https://example.com/post',
      NYPL_API_SCHEMA_URL: 'https://example.com/schema',
      NYPL_OAUTH_KEY: 'test-key',
      NYPL_OAUTH_SECRET: 'test-secret',
      NYPL_OAUTH_URL: 'https://example.com/oauth'
    })
  })

  after(() => {
    sinon.restore()
  })

  it('should export a handler function', () => {
    assert.strictEqual(typeof poster.handler, 'function')
  })

  it('should export a kinesisHandler async function', () => {
    assert.strictEqual(typeof poster.kinesisHandler, 'function')
  })

  it('should ignore records without kinesis data', async () => {
    // An event missing the 'kinesis' property payload
    const mockEvent = { Records: [{}] }
    
    // The handler should safely ignore it and resolve undefined
    const result = await poster.handler(mockEvent, {})
    assert.strictEqual(result, undefined)
  })
})