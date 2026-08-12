class LocalReportQueue {
  constructor() {
    this.messages = [];
  }
  async send(message) {
    this.messages.push(structuredClone(message));
  }
  async receive() {
    const message = this.messages.shift();
    if (!message) return null;
    let settled = false;
    return {
      body: message,
      ack: async () => {
        settled = true;
      },
      nack: async () => {
        if (!settled) this.messages.push(message);
        settled = true;
      },
      extend: async () => {},
    };
  }
}

class LocalArtifactStore {
  constructor() {
    this.artifacts = new Map();
  }
  async put({ jobId, contentType, body }) {
    this.artifacts.set(jobId, { contentType, body });
    return {
      artifactId: jobId,
      contentType,
      location: `local-report://${jobId}`,
    };
  }
  async get(artifactId) {
    return this.artifacts.get(artifactId) || null;
  }
  async presign(artifactId) {
    if (!this.artifacts.has(artifactId))
      throw new Error("report artifact not found");
    return `local-report://${artifactId}`;
  }
  destroy() {}
}

module.exports = { LocalReportQueue, LocalArtifactStore };
