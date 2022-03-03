# Retiler

----------------------------------

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


## Installation & Usage

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
docker build --rm -t retiler:TAG .
```

## Running Tests

```bash
npm run test
```