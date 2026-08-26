'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const { downloadToFile, downloadText, DownloadError } = require('../lib/download');
const { createFakeServer } = require('./helpers/server');
const { makeTmpDir, removeTmpDir } = require('./helpers/tmp');

const tmpDir = makeTmpDir('download-');
after(() => removeTmpDir(tmpDir));

test('download: downloadToFile fetches a normal 200 response to disk', async () => {
  const { baseUrl, close } = await createFakeServer({
    '/asset.bin': Buffer.from('hello world'),
  });
  try {
    const dest = `${tmpDir}/asset.bin`;
    const total = await downloadToFile(`${baseUrl}asset.bin`, dest);
    assert.equal(total, 11);
    assert.equal(fs.readFileSync(dest, 'utf8'), 'hello world');
  } finally {
    await close();
  }
});

test('download: downloadToFile follows redirects', async () => {
  const { baseUrl, close } = await createFakeServer({
    '/redirect.bin': { redirect: '/real.bin' },
    '/real.bin': Buffer.from('redirected content'),
  });
  try {
    const dest = `${tmpDir}/redirected.bin`;
    await downloadToFile(`${baseUrl}redirect.bin`, dest);
    assert.equal(fs.readFileSync(dest, 'utf8'), 'redirected content');
  } finally {
    await close();
  }
});

test('download: downloadToFile throws an explicit error on HTTP error status', async () => {
  const { baseUrl, close } = await createFakeServer({
    '/missing.bin': { status: 404 },
  });
  try {
    await assert.rejects(
      downloadToFile(`${baseUrl}missing.bin`, `${tmpDir}/missing.bin`),
      (err) => {
        assert.ok(err instanceof DownloadError);
        assert.match(err.message, /404/);
        return true;
      }
    );
  } finally {
    await close();
  }
});

test('download: downloadToFile throws an explicit error on server error status', async () => {
  const { baseUrl, close } = await createFakeServer({
    '/broken.bin': { status: 500 },
  });
  try {
    await assert.rejects(downloadToFile(`${baseUrl}broken.bin`, `${tmpDir}/broken.bin`), DownloadError);
  } finally {
    await close();
  }
});

test('download: downloadToFile throws an explicit network error on connection reset', async () => {
  const { baseUrl, close } = await createFakeServer({
    '/reset.bin': { reset: true },
  });
  try {
    await assert.rejects(downloadToFile(`${baseUrl}reset.bin`, `${tmpDir}/reset.bin`), DownloadError);
  } finally {
    await close();
  }
});

test('download: downloadToFile throws an explicit error for unreachable hosts', async () => {
  await assert.rejects(
    downloadToFile('http://127.0.0.1:1/unreachable.bin', `${tmpDir}/unreachable.bin`),
    DownloadError
  );
});

test('download: downloadToFile rejects declared content-length above maxBytes', async () => {
  const { baseUrl, close } = await createFakeServer({
    '/big.bin': Buffer.alloc(1000, 1),
  });
  try {
    await assert.rejects(
      downloadToFile(`${baseUrl}big.bin`, `${tmpDir}/big.bin`, { maxBytes: 10 }),
      DownloadError
    );
  } finally {
    await close();
  }
});

test('download: downloadToFile does not leave a partial file behind on failure', async () => {
  const { baseUrl, close } = await createFakeServer({
    '/big2.bin': Buffer.alloc(1000, 2),
  });
  try {
    const dest = `${tmpDir}/big2.bin`;
    await assert.rejects(downloadToFile(`${baseUrl}big2.bin`, dest, { maxBytes: 10 }));
    assert.equal(fs.existsSync(dest), false);
  } finally {
    await close();
  }
});

test('download: downloadToFile preserves a pre-existing destination file', async () => {
  const { baseUrl, close } = await createFakeServer({
    '/existing.bin': Buffer.from('replacement'),
  });
  try {
    const dest = `${tmpDir}/existing.bin`;
    fs.writeFileSync(dest, 'original');

    await assert.rejects(
      downloadToFile(`${baseUrl}existing.bin`, dest),
      (err) => {
        assert.ok(err instanceof DownloadError);
        assert.match(err.message, /EEXIST/);
        return true;
      }
    );
    assert.equal(fs.readFileSync(dest, 'utf8'), 'original');
  } finally {
    await close();
  }
});

test('download: downloadText fetches small text payloads (e.g. checksums.txt)', async () => {
  const { baseUrl, close } = await createFakeServer({
    '/checksums.txt': 'abc123  file.tar.gz\n',
  });
  try {
    const text = await downloadText(`${baseUrl}checksums.txt`);
    assert.equal(text, 'abc123  file.tar.gz\n');
  } finally {
    await close();
  }
});

test('download: downloadText throws an explicit error on HTTP error status', async () => {
  const { baseUrl, close } = await createFakeServer({
    '/checksums.txt': { status: 404 },
  });
  try {
    await assert.rejects(downloadText(`${baseUrl}checksums.txt`), DownloadError);
  } finally {
    await close();
  }
});

test('download: downloadText enforces maxBytes', async () => {
  const { baseUrl, close } = await createFakeServer({
    '/checksums.txt': 'x'.repeat(1000),
  });
  try {
    await assert.rejects(downloadText(`${baseUrl}checksums.txt`, { maxBytes: 10 }), DownloadError);
  } finally {
    await close();
  }
});

test('download: downloadText enforces maxBytes while streaming without content-length', async () => {
  const response = new Response(Buffer.alloc(1000, 3));
  const originalArrayBuffer = response.arrayBuffer.bind(response);
  let arrayBufferCalled = false;
  response.arrayBuffer = async () => {
    arrayBufferCalled = true;
    return originalArrayBuffer();
  };

  assert.equal(response.headers.get('content-length'), null);
  await assert.rejects(
    downloadText('https://example.test/checksums.txt', {
      maxBytes: 10,
      fetchImpl: async () => response,
    }),
    (err) => {
      assert.ok(err instanceof DownloadError);
      assert.match(err.message, /exceeded the maximum allowed size/);
      return true;
    }
  );
  assert.equal(arrayBufferCalled, false);
});
