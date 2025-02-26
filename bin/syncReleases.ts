import { Octokit } from "@octokit/rest"
import { createWriteStream, promises } from "fs";
import { Writable } from 'stream'

interface Manifest {
  releases: Array<any>
}

const manifest: Manifest = { releases: [] }

const token = process.env.SUBALPINE_GITHUB_TOKEN

const octokit = new Octokit({
  auth: token
})

const releasesResponse = await octokit.request('GET /repos/subalpine-circuits/SynthEngine/releases', {
  owner: 'OWNER',
  repo: 'REPO',
  headers: {
    'X-GitHub-Api-Version': '2022-11-28'
  }
})

await Promise.all(releasesResponse.data.map(async (d) => {
  const asset = d.assets[0]

  const release = await octokit.request('GET /repos/subalpine-circuits/SynthEngine/releases/' + d.id, {
    owner: 'OWNER',
    repo: 'REPO',
    headers: {
      'X-GitHub-Api-Version': '2022-11-28'
    }
  })

  const tagResp = await octokit.request('GET /repos/subalpine-circuits/SynthEngine/git/ref/tags/' + release.data.tag_name, {
    owner: 'OWNER',
    repo: 'REPO',
    headers: {
      'X-GitHub-Api-Version': '2022-11-28'
    }
  })

  const downloadUrl = asset.url

  const fileName = `SA-01_${release.data.tag_name}.bin`
  const firmwareBinaryResp = await fetch(downloadUrl, {
    headers: {
      Accept: "application/octet-stream",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });

  if (firmwareBinaryResp.ok && firmwareBinaryResp.body) {
    await firmwareBinaryResp.body.pipeTo(Writable.toWeb(createWriteStream(`src/assets/firmware/${fileName}`)))
  }
  else {
    console.error("failed to download firmware for release")
  }

  manifest.releases.unshift({
    id: releasesResponse.data[0].id,
    tag: release.data.tag_name,
    filename: fileName,
    releaseNotes: release.data.body,
    publishDate: release.data.published_at,
    commit: tagResp.data.object.sha.slice(0, 7)
  })
}))

await promises.writeFile('src/assets/firmware/manifest.json', JSON.stringify(manifest), 'utf8')

console.log('written')