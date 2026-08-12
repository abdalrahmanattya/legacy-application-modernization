class FaultQueue {
  constructor({ maxReceiveCount = 3 } = {}) {
    this.available = [];
    this.inflight = new Map();
    this.deadLetters = [];
    this.sequence = 0;
    this.maxReceiveCount = maxReceiveCount;
  }

  async send(body) {
    this.available.push({
      id: String(++this.sequence),
      body: structuredClone(body),
      receiveCount: 0,
    });
  }

  duplicate() {
    const message = this.available[0];
    if (message)
      this.available.push({
        ...structuredClone(message),
        id: String(++this.sequence),
      });
  }

  async receive() {
    const message = this.available.shift();
    if (!message) return null;
    message.receiveCount += 1;
    if (message.receiveCount > this.maxReceiveCount) {
      this.deadLetters.push(message);
      return null;
    }
    this.inflight.set(message.id, message);
    let settled = false;
    return {
      body: structuredClone(message.body),
      receiveCount: message.receiveCount,
      ack: async () => {
        if (settled) return;
        this.inflight.delete(message.id);
        settled = true;
      },
      nack: async () => {
        if (settled) return;
        this.inflight.delete(message.id);
        this.available.push(message);
        settled = true;
      },
      extend: async () => {},
    };
  }

  expireVisibility() {
    for (const message of this.inflight.values()) this.available.push(message);
    this.inflight.clear();
  }
}

class FaultArtifactStore {
  constructor() {
    this.artifacts = new Map();
    this.failAfterPut = false;
  }

  async put({ jobId, ...artifact }) {
    const stored = { artifactId: jobId, ...artifact };
    this.artifacts.set(jobId, stored);
    if (this.failAfterPut) throw new Error("injected post-upload crash");
    return stored;
  }
}

module.exports = { FaultQueue, FaultArtifactStore };
