# Discovery Bib/Item Poster

This lambda should be deployed to two different lambdas.
One to handle bibs, another for items. It reads those bibs or items from stream, then posts them to the bib or item service.

## Setup

1.  Run

```
npm install
npm install -g node-lambda
cp example.env .env
cp deploy.example.env deploy-bib.env
cp deploy.example.env deploy-item.env
```

1.  Fill in `.env` with amazon account information

1.  Fill in `deploy-*.env` files with the following variables

| Variable            | Value                     |
| :-------------      | :-------------            |
| NYPL_API_SCHEMA_URL | URL to bib or item schema |
| NYPL_POST_TYPE      | 'bib' or 'item'           |
| NYPL_API_POST_URL   | URL this will POST to     |
| NYPL_OAUTH_URL      |                           |
| NYPL_OAUTH_KEY      |                           |
| NYPL_OAUTH_SECRET   |.                          |


Generate mock-data by running

```
node kinesify-data.js event.unencoded.sierra_bib_post_request.json event.json https://platform.nypl.org/api/v0.1/current-schemas/BibPostRequest
```

This will take the un-encoded data in `event.unencoded.bibs.json` and put it in a kinesis stream format using the avro schema. You can load items by replacing the input file with `event.unencoded.items.json`

Assuming you have the proper API and oauth credentials setup in your `.env`, you can run the lambda locally using the mock data in `event.json`

```
node-lambda run
```

This will take `event.json` (which is mocked-up kinesis stream data) as input, authenticate with oauth server, retrieve schema from Schema API, parse stream data, then post it to the bib or item API depending on config.

## GIT Workflow

We follow a [feature-branch](https://www.atlassian.com/git/tutorials/comparing-workflows/feature-branch-workflow) workflow. Our branches, ordered from least-stable to most stable are:

| branch        | AWS account      |
|:--------------|:-----------------|
| `development` | nypl-sandbox     |
| `qa`          | nypl-digital-dev |
| `master`      | nypl-digital-dev |

If you need to introduce/update the application code, you `SHOULD`:

* Create feature branches off the `development` branch.
* Send a PR pointing to the `development` branch upon completion of feature branch.
* Once the PR is approved, it should be merged into the `development` branch.
* When a release is to be deployed, the `development` branch will be merged into `qa`.
* Upon feeling happy with the results in QA, merge `qa` into `master`.

## Deploy

Update event.json by running the above kinesify-data.js script for either item or bib.

Make sure you have the correct config/[bib|item]-[environment].env files. See config/deploy.example.env for an
example.  

Then run:

```
npm run deploy-[bib|item|holding]-[development|qa|production]
```

Will deploy to Lambdas called `[bib|item|holding]Poster-[environment]`. You can add a Kinesis stream triggers to execute function if not already added, but Kinesis stream triggers should be added automatically.
