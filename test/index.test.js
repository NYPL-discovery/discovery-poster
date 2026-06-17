const assert = require('assert')
const sinon = require('sinon')
const { config } = require('@nypl/node-utils')
const avro = require('avsc')
const OAuth = require('oauth')
const winston = require('winston')
const poster = require('../index')

describe('Discovery Bib Poster', () => {
  let fetchStub, oauthMock, oauthConstructorStub, avroTypeStub, typeMock

  before(async () => {
    // Stub the config loader and initialize the index.js module variables once
    const loadConfigStub = sinon.stub(config, 'loadConfig').resolves({
      NYPL_API_POST_URL: 'https://example.com/post',
      NYPL_API_SCHEMA_URL: 'https://example.com/schema',
      NYPL_OAUTH_KEY: 'test-key',
      NYPL_OAUTH_SECRET: 'test-secret',
      NYPL_OAUTH_URL: 'https://example.com/oauth'
    })
    
    // A dummy call to trigger the init() block without falling through to Kinesis
    await poster.handler({ Records: [{}] }, {})
    loadConfigStub.restore()
  })

  beforeEach(() => {
    // Stub the wrapper method instead of the global fetch API.
    // Reject by default so any unmocked URL explicitly fails the test
    fetchStub = sinon.stub(poster, '_fetch').rejects(new Error('Unmocked fetch call'))

    // Schema fetch only takes 1 argument
    fetchStub.withArgs('https://example.com/schema').resolves({
      ok: true,
      json: async () => ({ data: { schema: '{"type":"record"}' } })
    })

    // Stub the OAuth2 constructor and getOAuthAccessToken method
    oauthMock = { getOAuthAccessToken: sinon.stub() }
    oauthConstructorStub = sinon.stub(OAuth, 'OAuth2').returns(oauthMock)

    // Stub the Avro schema decoder
    typeMock = { fromBuffer: sinon.stub().returns({ id: '123' }) }
    avroTypeStub = sinon.stub(avro.Type, 'forSchema').returns(typeMock)
  })

  afterEach(() => {
    sinon.restore()
  })

  describe('Exports and Main Handler', () => {
    let kinesisStub

    beforeEach(() => {
      kinesisStub = sinon.stub(poster, 'kinesisHandler').resolves()
    })

    it('should export a handler function', () => {
      assert.strictEqual(typeof poster.handler, 'function')
    })

    it('should export a kinesisHandler async function', () => {
      assert.strictEqual(typeof poster.kinesisHandler, 'function')
    })

    it('should safely ignore the event if the first record has no kinesis property', async () => {
      // Notice record 2 has kinesis data, but the handler should only evaluate record 1
      const mockEvent = { Records: [{}, { kinesis: { data: 'test' } }] }
      const result = await poster.handler(mockEvent, {})
      
      assert.strictEqual(result, undefined)
      assert.strictEqual(kinesisStub.called, false)
    })

    it('should pass ALL records to kinesisHandler if the first record has a kinesis property', async () => {
      const mockEvent = { Records: [{ kinesis: { data: 'first' } }, {}] }
      await poster.handler(mockEvent, {})
      
      assert.strictEqual(kinesisStub.calledOnce, true)
      assert.deepStrictEqual(kinesisStub.firstCall.args[0], mockEvent.Records)
    })
  })

  describe('Kinesis Handler Workflow', () => {
    it('should retrieve token and schema, decode records, and post them', async () => {
      oauthMock.getOAuthAccessToken.yields(null, 'fake-token', 'refresh', null)
      
      // Post request has 2 arguments, so we must use sinon.match.any to catch the options object
      fetchStub.withArgs('https://example.com/post', sinon.match.any).resolves({
        status: 200,
        statusText: 'OK',
        json: async () => ({})
      })

      const mockRecords = [{ kinesis: { data: 'base64data' } }]
      await poster.kinesisHandler(mockRecords, {})

      // 1. Retrieve token check
      assert.strictEqual(oauthConstructorStub.calledOnce, true)
      assert.strictEqual(fetchStub.calledWith('https://example.com/schema'), true)
      
      // 2. Avro decode check
      assert.strictEqual(avroTypeStub.calledWith(JSON.parse('{"type":"record"}')), true)
      assert.strictEqual(typeMock.fromBuffer.calledWith(Buffer.from('base64data', 'base64')), true)

      // 3. PostRecords check
      const postCall = fetchStub.getCalls().find(call => call.args[0] === 'https://example.com/post')
      assert.ok(postCall, 'Expected fetch to be called with post URL')
      assert.strictEqual(postCall.args[1].headers['Authorization'], 'Bearer fake-token')
      assert.strictEqual(postCall.args[1].body, JSON.stringify([{ id: '123' }]))
    })

    it('should clear token and throw error on 401 response (triggering refresh on next run)', async () => {
      fetchStub.withArgs('https://example.com/post', sinon.match.any).resolves({
        status: 401,
        statusText: 'Unauthorized',
        text: async () => 'Token expired'
      })

      const mockRecords = [{ kinesis: { data: 'base64data' } }]
      
      // First attempt fails and throws
      await assert.rejects(poster.kinesisHandler(mockRecords, {}), Error)

      // On the very next execution, verify OAuth is called again (because the cache was cleared)
      oauthMock.getOAuthAccessToken.yields(null, 'new-fake-token', 'refresh', null)
      
      fetchStub.withArgs('https://example.com/post', sinon.match.any).resolves({
        status: 200,
        statusText: 'OK',
        json: async () => ({})
      })

      await poster.kinesisHandler(mockRecords, {})
      
      assert.strictEqual(oauthConstructorStub.calledOnce, true)
      
      const postCalls = fetchStub.getCalls().filter(call => call.args[0] === 'https://example.com/post')
      const finalPostCall = postCalls[postCalls.length - 1]
      assert.strictEqual(finalPostCall.args[1].headers['Authorization'], 'Bearer new-fake-token')
    })

    it('should throw an error for non-200 non-401 responses', async () => {
      fetchStub.withArgs('https://example.com/post', sinon.match.any).resolves({
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Server crash'
      })

      const mockRecords = [{ kinesis: { data: 'base64data' } }]
      await assert.rejects(poster.kinesisHandler(mockRecords, {}), Error)
    })

    it('should log data errors if present in the response body', async () => {
      fetchStub.withArgs('https://example.com/post', sinon.match.any).resolves({
        status: 200,
        statusText: 'OK',
        json: async () => ({ errors: ['Invalid property X', 'Invalid property Y'] })
      })

      // Spy on the winston Console transport exactly where the log executes
      const transportLogSpy = sinon.spy(winston.transports.Console.prototype, 'log')
      const mockRecords = [{ kinesis: { data: 'base64data' } }]
      
      await poster.kinesisHandler(mockRecords, {})

      const logCall = transportLogSpy.getCalls().find(call => 
        call.args[0] && call.args[0].message === 'Data error: Invalid property X,Invalid property Y'
      )
      assert.ok(logCall, 'Expected logger to output data error message')
    })
  })
})