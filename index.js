const avro = require('avsc')
const OAuth = require('oauth')
const winston = require('winston')
const { config } = require('@nypl/node-utils')

// Initialize cache
const CACHE = {}

let NYPL_API_POST_URL
let NYPL_API_SCHEMA_URL
let NYPL_OAUTH_KEY
let NYPL_OAUTH_SECRET
let NYPL_OAUTH_URL

const logger = winston.createLogger({
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({
      handleExceptions: true
    })
  ],
  exitOnError: false
})

logger.info({'message': 'Loading Discovery Poster'})

// kinesis stream handler
exports.kinesisHandler = async function (records, context) {
  logger.info({'message': 'Processing ' + records.length + ' records'})

  try {
    // retrieve token and schema
    const [accessToken, schemaData] = await Promise.all([token(), schema()])
    
    // load avro schema
    const avroType = avro.Type.forSchema(schemaData)
    
    // parse payload
    const parsedRecords = records.map(function (record) {
      return parseKinesis(record, avroType)
    })
    
    // post to API
    logger.info({'message': 'Posting records'})
    await postRecords(accessToken, parsedRecords)
  } catch (error) {
    logger.error({'message': error.message, 'error': error})
    throw error
  }

  // map to records objects as needed
  function parseKinesis (payload, avroType) {
    logger.info({'message': 'Parsing Kinesis'})
    // decode base64
    const buf = Buffer.from(payload.kinesis.data, 'base64')

    // decode avro
    const record = avroType.fromBuffer(buf)

    return record
  }

  // bulk posts records
  async function postRecords (accessToken, records) {
    const url = NYPL_API_POST_URL
    const options = {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(records)
    }

    // POST request
    logger.info({'message': 'Posting...'})
    let response
    try {
      response = await fetch(url, options)
    } catch (error) {
      logger.error({'message': 'POST Error! ', 'error': error})
      throw new Error()
    }

    const responseMeta = { status: response.status, statusText: response.statusText, url: response.url }
    logger.info({'message': 'Response: ' + response.status + ' ' + response.statusText})

    if (response.status !== 200) {
      try {
        responseMeta.body = await response.text()
      } catch (e) {
        logger.error({'message': 'POST Error! (Could not read body)', 'response': responseMeta})
        throw new Error()
      }

      if (response.status === 401) {
        // Clear access token so new one will be requested on retried request
        CACHE['accessToken'] = null
        CACHE['authFailedCount'] = (CACHE['authFailedCount'] || 0) + 1

        if (CACHE['authFailedCount'] === 1) {
          logger.warn({'message': 'Access token expired. Resetting and triggering retry.', 'response': responseMeta})
        } else {
          logger.error({'message': 'POST Error! Repeated 401s.', 'response': responseMeta})
        }
      } else {
        logger.error({'message': 'POST Error! ', 'response': responseMeta})
      }

      throw new Error()
    }

    try {
      const body = await response.json()
      if (body && body.errors && body.errors.length) {
        logger.info({'message': 'Data error: ' + body.errors})
      }
    } catch (e) {
      // Handle empty or non-JSON responses safely
    }
    
    CACHE['authFailedCount'] = 0
    logger.info({'message': 'POST Success'})
  }

  async function schema () {
    // schema in cache; just return it
    if (CACHE['schema']) {
      logger.info({'message': 'Already have schema'})
      return CACHE['schema']
    }

    logger.info({'message': 'Loading schema...'})
    let resp
    try {
      resp = await fetch(NYPL_API_SCHEMA_URL)
    } catch (error) {
      logger.info({'message': 'Error! ' + error})
      throw error
    }

    if (!resp.ok) {
      const text = await resp.text()
      throw new Error('HTTP error: ' + resp.status + ' ' + resp.statusText + ' - ' + text)
    }

    const body = await resp.json()
    if (body.data && body.data.schema) {
      logger.info({'message': 'Sucessfully loaded schema'})
      const schemaObj = JSON.parse(body.data.schema)
      CACHE['schema'] = schemaObj
      return schemaObj
    } else {
      logger.error({'message': 'Schema did not load'})
      throw new Error('Schema did not load')
    }
  }

  // oauth token retriever
  async function token () {
    // access token in cache; just return it
    if (CACHE['accessToken']) {
      logger.info({'message': 'Already authenticated'})
      return CACHE['accessToken']
    }

    // request a new token
    logger.info({'message': 'Requesting new token...'})
    return new Promise(function (resolve, reject) {
      const OAuth2 = OAuth.OAuth2
      const key = NYPL_OAUTH_KEY
      const secret = NYPL_OAUTH_SECRET
      const url = NYPL_OAUTH_URL
      const auth = new OAuth2(key, secret, url, null, 'oauth/token', null)
      
      auth.getOAuthAccessToken('', { grant_type: 'client_credentials' }, function (error, accessToken, refreshToken, results) {
        if (error) {
          reject(error)
          logger.error({'message': 'Not authenticated'})
        } else {
          logger.info({'message': 'Successfully authenticated'})
          CACHE['accessToken'] = accessToken
          resolve(accessToken)
        }
      })
    })
  }
}

async function init () {
  if (NYPL_API_POST_URL) return;

  ({
    NYPL_API_POST_URL,
    NYPL_API_SCHEMA_URL,
    NYPL_OAUTH_KEY,
    NYPL_OAUTH_SECRET,
    NYPL_OAUTH_URL
  } = await config.loadConfig(`./config/${process.env.FUNCTION_NAME}-${process.env.ENVIRONMENT}.yaml`));
}

// main function
exports.handler = async function (event, context) {
  await init()

  const record = event.Records[0]
  if (record.kinesis) {
    await exports.kinesisHandler(event.Records, context)
  }
}
