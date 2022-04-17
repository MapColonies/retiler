# Retiler

![badge-alerts-lgtm](https://img.shields.io/lgtm/alerts/github/MapColonies/retiler?style=for-the-badge)

![grade-badge-lgtm](https://img.shields.io/lgtm/grade/javascript/github/MapColonies/retiler?style=for-the-badge)

![snyk](https://img.shields.io/snyk/vulnerabilities/github/MapColonies/retiler?style=for-the-badge)

----------------------------------
retiler is a service intended to run as a [k8s job](https://kubernetes.io/docs/concepts/workloads/controllers/job/).

Tiles for rendering will be consumed from a job queue, currently using [pgboss](https://github.com/timgit/pg-boss).
Each tile holds a `metatile` value and `ZXY` postition. the tile image will be fetched from an `ArcGIS` service and will be splitted into 256x256 pixel tiles in PNG format according to position and metatile value.
finally the tiles will be stored on s3 storage.

## config
`app.queueName`: the job queue name to consume tiles from

`app.jobQueue.noSupervisor`: flag for maintenance and monitoring operations on the job queue. defaults to true (meaning no supervision)

`map.url`: the url of the `ArcGIS` service to fetch the map from

`map.client.timeoutMs`: the timeout in ms for a fetch map request. defaults to 60000

`tilesStorage.s3Bucket`: the bucket name for tiles storage

`tilesStorage.layout.format`: the format of the tile's key in the storage bucket, the z, x, y values of the tile can be retrieved to the key. defaults to `prefix/{z}/{x}/{y}.png`
e.g. `prefix/{z}/{x}/{y}.png` formated to the tile
```json
{ z: 3, x: 10, y: 4 }
```
will result in the key: "prefix/3/10/4.png"

`tilesStorage.layout.shouldFlipY`: determine if the key value of y (formatted by `tilesStorage.layout.format`) should be flipped over the y axis. e.g. if on the y axis there are overall 8 tiles with y values of 0 through 7 then 0 will be flipped to 7 and 7 to 0, 1 to 6 and 6 to 1 and so on. defaults to true

## Run Locally

Clone the project

```bash

git clone https://github.com/MapColonies/retiler.git

```

Go to the project directory

```bash

cd retiler

```

Install dependencies

```bash

npm install

```

Start the server

```bash

npm start

```

## Running Tests

To run tests, run the following command

```bash

npm run test

```

To only run unit tests:
```bash
npm run test:unit
```

To only run integration tests:
```bash
npm run test:integration
```