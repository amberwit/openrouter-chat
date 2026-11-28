const { createCipheriv, createDecipheriv, randomBytes } = require('node:crypto');
const { constants } = require('node:fs');
const { link, lstat, mkdir, open, unlink } = require('node:fs/promises');
const { homedir } = require('node:os');
const path = require('node:path');

const keySize = 32;
const nonceSize = 12;
const tagSize = 16;
const maxKeyLength = 512;
const windows = process.platform === 'win32';

function isApiKey(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxKeyLength && !/[^!-~]/.test(value);
}

function assertPrivate(stat) {
  // On Windows the user's profile directory supplies the inherited ACL.
  if (!windows && (stat.uid !== process.getuid() || (stat.mode & 0o077))) {
    throw new Error('Credential storage must be private to the current user');
  }
}

function createCredentialStore(directory = path.join(homedir(), '.openrouter-chat')) {
  const keyFile = path.join(directory, 'credential-key-v1');

  async function readKey() {
    const entry = await lstat(keyFile, windows ? { bigint: true } : undefined);
    if (!entry.isFile()) throw new Error('Invalid credential key file');
    assertPrivate(entry);
    const file = await open(keyFile, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const stat = await file.stat();
      assertPrivate(stat);
      if (!stat.isFile() || stat.size !== keySize) throw new Error('Invalid credential key file');

      if (windows) {
        // Windows path and handle stats can report different IDs for the same file.
        // Recheck the path using the same API; this is not an atomic no-follow open.
        const current = await lstat(keyFile, { bigint: true }).catch((err) => {
          if (err.code === 'ENOENT') return null;
          throw err;
        });
        if (!current?.isFile() || current.dev !== entry.dev || current.ino !== entry.ino ||
            current.size !== BigInt(keySize)) {
          throw new Error('Invalid credential key file');
        }
      } else if (stat.ino !== entry.ino || stat.dev !== entry.dev) {
        throw new Error('Invalid credential key file');
      }

      const key = await file.readFile();
      if (key.length !== keySize) throw new Error('Invalid credential key file');
      return key;
    } finally {
      await file.close();
    }
  }

  async function loadKey(create) {
    if (create) {
      await mkdir(directory, { mode: 0o700 }).catch((err) => {
        if (err.code !== 'EEXIST') throw err;
      });
    }

    try {
      const dir = await lstat(directory);
      if (!dir.isDirectory()) throw new Error('Invalid credential storage directory');
      assertPrivate(dir);
      return await readKey();
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      if (!create) return null;
    }

    // Publish only a complete key, without replacing a key another process already created.
    const temporary = path.join(directory, `.key-${randomBytes(16).toString('hex')}`);
    const file = await open(temporary, 'wx', 0o600);
    try {
      try {
        await file.writeFile(randomBytes(keySize));
        await file.sync();
      } finally {
        await file.close();
      }
      await link(temporary, keyFile).catch((err) => {
        if (err.code !== 'EEXIST') throw err;
      });
    } finally {
      await unlink(temporary);
    }
    return readKey();
  }

  const aad = (origin) => Buffer.from(`openrouter-chat:credential:v1:${origin}`);

  return {
    async seal(apiKey, origin) {
      if (!isApiKey(apiKey)) throw new Error('Invalid API key');
      const key = await loadKey(true);
      const nonce = randomBytes(nonceSize);
      const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: tagSize });
      cipher.setAAD(aad(origin));
      const encrypted = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
      return `v1.${Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64url')}`;
    },

    async unseal(record, origin) {
      const maxRecordLength = 3 + Math.ceil((nonceSize + tagSize + maxKeyLength) * 4 / 3);
      if (typeof record !== 'string' || record.length > maxRecordLength || !/^v1\.[\w-]+$/.test(record)) return null;
      const bytes = Buffer.from(record.slice(3), 'base64url');
      if (bytes.length <= nonceSize + tagSize || bytes.length > nonceSize + tagSize + maxKeyLength ||
          bytes.toString('base64url') !== record.slice(3)) return null;

      const key = await loadKey(false);
      if (!key) return null;
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, nonceSize), { authTagLength: tagSize });
        decipher.setAAD(aad(origin));
        decipher.setAuthTag(bytes.subarray(nonceSize, nonceSize + tagSize));
        const apiKey = Buffer.concat([decipher.update(bytes.subarray(nonceSize + tagSize)), decipher.final()]).toString('utf8');
        return isApiKey(apiKey) ? apiKey : null;
      } catch {
        return null;
      }
    },
  };
}

module.exports = { createCredentialStore, isApiKey };