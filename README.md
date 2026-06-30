# Discovery Bib/Item/Holding Poster

This lambda should be deployed to three different lambdas.
One to handle bibs, another for items, and another for holdings. It reads those bibs, items, or holdings from the stream, then posts them to the matching service.

## Setup

1.  Run

```
npm install
```


Generate mock-data by running

```
node kinesify-data.js event.unencoded.sierra_bib_post_request.json event.json https://platform.nypl.org/api/v0.1/current-schemas/BibPostRequest
```

This will take the un-encoded data in `event.unencoded.bibs.json` and put it in a kinesis stream format using the avro schema. You can load items by replacing the input file with `event.unencoded.items.json`


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

Deployment is handled automatically on Github. Merging to qa/production will deploy all the services (i.e. Bib/Item/Holding) in that deployment
