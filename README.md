# Retiler

![badge-alerts-lgtm](https://img.shields.io/lgtm/alerts/github/MapColonies/retiler?style=for-the-badge)

![grade-badge-lgtm](https://img.shields.io/lgtm/grade/javascript/github/MapColonies/retiler?style=for-the-badge)

![snyk](https://img.shields.io/snyk/vulnerabilities/github/MapColonies/retiler?style=for-the-badge)

----------------------------------
retiler is a thin service that supposed to run as a [k8s job](https://kubernetes.io/docs/concepts/workloads/controllers/job/). It will retile a web map service and store the output tiles in a storage.


## Introduction

retiler is build from four main parts:
- **jobs queue provider** - a queue of jobs that hold tiles
- **map provider** - fetches a web map based on the tile (metatile)
- **map splitter provider** - splits the web map to single tiles e.g. `metatile=1`
- **tiles storage provider** - stores tiles to a storage

## Writing Retiler Providers

Implementation details for all providers could be found [here](./src/retiler/interfaces.ts). The sections bellow provide a short overview of the providers used by retiler.

### jobs queue provider

this provider should implement the functions bellow
- `get()` get a job from the queue
- `isEmpty()` check if the queue is empty
- `complete()` mark the job as completed
- `fail()` mark the job as failed

retiler checks when the queue is empty using `isEmpty()` and if so it successfully terminates the k8s job

### map provider

this provider should implement the functions bellow
- `getMapStream()` get a readable stream of the map image payload

this provider may implement the functions bellow
- *`getMap()`* get an http response with a buffer of the map image payload

### map splitter provider

this provider should implement the functions bellow
- `generateSplitPipeline()` creates a Duplex stream that will tile the map image

### tiles storage layout

`tilesStorage.layout.format`: the format of the tile's key in the storage bucket, the z, x, y values of the tile can be retrieved to the key, e.g. `prefix/{z}/{x}/{y}/sufix.png` formated to the tile
```json
{ z: 3, x: 10, y: 4 }
```
will result in the key: "prefix/3/10/4/sufix.png"

`tilesStorage.layout.shouldFlipY`: determine if the key value of y (formatted by `tilesStorage.layout.format`) should be flipped over the y axis. e.g. if on the y axis there are overall 8 tiles with y values of 0 through 7 then 0 will be flipped to 7 and 7 to 0, 1 to 6 and 6 to 1 and so on.

## Installation & Usage

After retiler is cloned, currently, this [file](./src/containerConfig.ts) must be updated to inject the needed providers. Then install the relevant npm packages. Finally, add or edit the relevant env variables to support the selection of the providers.

### Locally

Use locally by cloning from GitHub

```bash
git clone https://github.com/MapColonies/retiler.git
cd retiler
npm install
npm run start
```

### k8s

Build an image to run as a k8s job

```docker
docker build --rm -t retiler:<TAG> .
```

## Running Tests

```bash
npm run test
```