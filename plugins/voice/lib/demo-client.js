// src/client/voice-client.ts
var DEFAULT_PRESENTATION = { expressions: ["neutral", "happy", "sad", "surprised", "thinking", "confused", "calm"], gestures: ["nod", "shake", "wave", "point", "celebrate"], components: ["card", "choices", "progress", "form"] };
var CLIENT_CAPABILITIES = ["turns", "audio.framed", "playback", "playback.flow", "agent.activity", "response.stop", "conversation.select", "presentation.state", "presentation.cue", "ui.render"];
var RATE = 24e3;
var requestId = () => `${Date.now().toString(36)}-${Array.from(crypto.getRandomValues(new Uint32Array(3)), (v) => v.toString(36)).join("-")}`;
var VoiceClient = class extends EventTarget {
  ws;
  audio;
  streams = /* @__PURE__ */ new Map();
  timers = /* @__PURE__ */ new Map();
  interval;
  heartbeat;
  currentTurn;
  epoch = 0;
  clockOffset = 0;
  busy = false;
  connected = false;
  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
  send(message) {
    if (this.ws?.readyState !== WebSocket.OPEN) throw new Error("\u8BED\u97F3\u8FDE\u63A5\u5C1A\u672A\u5C31\u7EEA");
    this.ws.send(JSON.stringify(message));
  }
  async connect(endpoint, token, deviceId, presentation = DEFAULT_PRESENTATION) {
    this.disconnect();
    const epoch = ++this.epoch;
    this.audio = new AudioContext();
    await this.audio.resume();
    if (epoch !== this.epoch) return;
    const url = new URL(endpoint);
    url.searchParams.set("token", token);
    if (!["ws:", "wss:"].includes(url.protocol)) throw new Error("\u8BF7\u8F93\u5165 ws:// \u6216 wss:// \u5730\u5740");
    const socket = this.ws = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    let welcome = false;
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("\u63E1\u624B\u8D85\u65F6"));
        socket.close();
      }, 1e4);
      socket.onopen = () => {
        if (epoch === this.epoch) socket.send(JSON.stringify({ type: "hello", version: 2, deviceId, capabilities: CLIENT_CAPABILITIES, presentation }));
      };
      socket.onerror = () => {
        clearTimeout(timer);
        reject(new Error("\u8FDE\u63A5\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u5730\u5740\u4E0E\u8BBE\u5907\u4EE4\u724C"));
      };
      socket.onclose = () => {
        clearTimeout(timer);
        if (!welcome) reject(new Error("\u63E1\u624B\u672A\u5B8C\u6210"));
        if (epoch !== this.epoch) return;
        this.connected = false;
        this.busy = false;
        clearInterval(this.interval);
        clearInterval(this.heartbeat);
        this.clearAudio(false);
        this.emit("connection", { connected: false });
      };
      socket.onmessage = (event) => {
        if (epoch !== this.epoch) return;
        try {
          if (typeof event.data !== "string") {
            this.binary(event.data);
            return;
          }
          const m = JSON.parse(event.data);
          if (m.type === "welcome") {
            clearTimeout(timer);
            welcome = true;
            this.connected = true;
            this.clockOffset = typeof m.serverTime === "number" ? m.serverTime - Date.now() : 0;
            resolve();
            this.emit("connection", { connected: true });
          }
          if (m.type === "error" && !welcome) {
            clearTimeout(timer);
            reject(new Error(m.message));
            socket.close();
          }
          this.message(m);
        } catch (error2) {
          this.emit("client.error", { message: error2 instanceof Error ? error2.message : String(error2) });
          this.disconnect();
        }
      };
    });
    try {
      await ready;
    } catch (e) {
      if (epoch === this.epoch) this.disconnect();
      throw e;
    }
    if (epoch !== this.epoch) return;
    this.interval = setInterval(() => {
      for (const stream of this.streams.values()) this.feedback(stream);
    }, 250);
    this.heartbeat = setInterval(() => this.send({ type: "ping", time: Date.now() }), 15e3);
  }
  disconnect() {
    ++this.epoch;
    clearInterval(this.interval);
    clearInterval(this.heartbeat);
    this.clearAudio(false);
    this.ws?.close();
    this.ws = void 0;
    void this.audio?.close().catch(() => {
    });
    this.audio = void 0;
    this.connected = false;
    this.busy = false;
    this.currentTurn = void 0;
    this.emit("connection", { connected: false });
  }
  query(text) {
    this.clearAudio(true);
    this.send({ type: "query", requestId: requestId(), text });
  }
  speak(text) {
    this.clearAudio(true);
    this.send({ type: "speak", requestId: requestId(), text });
  }
  listenStart() {
    this.clearAudio(true);
    this.send({ type: "listen", state: "start", requestId: requestId() });
  }
  sendAudio(pcm) {
    if (this.ws?.readyState !== WebSocket.OPEN) throw new Error("\u672A\u8FDE\u63A5");
    this.ws.send(pcm);
  }
  listenStop() {
    this.send({ type: "listen", state: "stop", turnId: this.currentTurn });
  }
  cancel() {
    this.send({ type: "turn.cancel", turnId: this.currentTurn });
    this.clearAudio(true);
  }
  stopSpeech() {
    this.send({ type: "response.stop", turnId: this.currentTurn });
    this.clearAudio(true);
  }
  selectConversation(conversationId) {
    this.clearAudio(true);
    this.send({ type: "conversation.select", conversationId });
  }
  syncUI() {
    this.send({ type: "ui.sync" });
  }
  serverNow() {
    return Date.now() + this.clockOffset;
  }
  action(component, actionId, values = {}) {
    this.clearAudio(true);
    this.send({ type: "ui.action", requestId: requestId(), componentId: component.id, instanceId: component.instanceId, revision: component.revision, actionId, values });
  }
  dismiss(component) {
    this.send({ type: "ui.dismiss", componentId: component.id, revision: component.revision, instanceId: component.instanceId });
  }
  message(m) {
    if (m.type === "turn.start") {
      this.currentTurn = m.turnId;
      this.busy = true;
    }
    if (m.type === "audio.start") {
      if (m.framing !== "ysv2") throw new Error("\u53C2\u8003\u5BA2\u6237\u7AEF\u9700\u8981 audio.framed");
      this.streams.set(m.streamId, { id: m.streamId, turnId: m.turnId, received: 0, played: 0, sequence: 0, nextTime: 0, frames: [], closed: false, cues: [] });
    }
    if (m.type === "presentation.cue") {
      if (m.timing === "now") this.emit("cue", m);
      else {
        const stream = this.streams.get(m.streamId);
        if (stream && !stream.closed) {
          stream.cues.push(m);
          this.scheduleCues(stream);
        }
      }
    }
    if (m.type === "presentation.reset") {
      this.clearCueTimers();
      this.emit("reset", m);
    }
    if (m.type === "audio.end") {
      const stream = this.streams.get(m.streamId);
      if (stream) {
        stream.total = m.samples;
        if (!["completed", "done"].includes(m.reason)) this.clearStream(stream, true);
        else this.feedback(stream);
      }
    }
    if (m.type === "turn.end") {
      if (m.turnId === this.currentTurn) {
        this.currentTurn = void 0;
        this.busy = false;
      }
      if (!["completed", "done"].includes(m.reason)) {
        const stream = this.streams.get(m.streamId);
        if (stream) this.clearStream(stream, true);
      }
    }
    if (m.type === "conversation.selected") {
      this.clearAudio(true);
      this.emit("reset", m);
    }
    this.emit("event", m);
  }
  binary(data) {
    const view = new DataView(data);
    if (view.byteLength < 24 || view.getUint32(0, false) !== 1498633778) throw new Error("\u65E0\u6548\u97F3\u9891\u5E27\u5934");
    const id = view.getUint32(4, true), sequence = view.getUint32(8, true), offset = view.getFloat64(12, true), bytes = view.getUint32(20, true), stream = this.streams.get(id);
    if (!stream || stream.closed) return;
    if (bytes !== view.byteLength - 24 || bytes % 2 || sequence !== stream.sequence || offset !== stream.received || !Number.isSafeInteger(offset)) throw new Error("\u97F3\u9891\u5E27\u5E8F\u53F7\u6216\u91C7\u6837\u4F4D\u7F6E\u4E0D\u8FDE\u7EED");
    const audio = this.audio;
    const buffer = audio.createBuffer(1, bytes / 2, RATE), samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(24 + i * 2, true) / 32768;
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.connect(audio.destination);
    const frame = { source, start: Math.max(stream.nextTime, audio.currentTime + 0.04), offset, samples: samples.length };
    stream.frames.push(frame);
    stream.nextTime = frame.start + samples.length / RATE;
    stream.received += samples.length;
    stream.sequence++;
    source.onended = () => {
      stream.played = Math.max(stream.played, offset + samples.length);
      stream.frames = stream.frames.filter((f) => f !== frame);
      source.disconnect();
      this.feedback(stream);
    };
    source.start(frame.start);
    this.scheduleCues(stream);
  }
  scheduleCues(stream) {
    for (const cue of [...stream.cues]) {
      const frame = stream.frames.find((f) => cue.sampleOffset >= f.offset && cue.sampleOffset < f.offset + f.samples);
      if (!frame) continue;
      const timers = this.timers.get(stream.id) ?? /* @__PURE__ */ new Set();
      this.timers.set(stream.id, timers);
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!stream.closed) this.emit("cue", cue);
      }, Math.max(0, (frame.start + (cue.sampleOffset - frame.offset) / RATE - this.audio.currentTime) * 1e3));
      timers.add(timer);
      stream.cues = stream.cues.filter((c) => c !== cue);
    }
  }
  played(stream) {
    let samples = stream.played;
    for (const frame of stream.frames) if (this.audio.currentTime >= frame.start) samples = Math.max(samples, frame.offset + Math.min(frame.samples, Math.floor((this.audio.currentTime - frame.start) * RATE)));
    return Math.min(samples, stream.received);
  }
  feedback(stream) {
    if (stream.closed || !this.connected) return;
    const played = this.played(stream);
    const ended = stream.total !== void 0 && played === stream.total;
    this.send({ type: "playback", turnId: stream.turnId, streamId: stream.id, state: ended ? "ended" : "progress", playedSamples: played, bufferedSamples: stream.received - played });
    if (ended) {
      stream.closed = true;
      stream.cues = [];
      this.prune();
    }
  }
  clearStream(stream, notify) {
    if (stream.closed) return;
    const played = this.played(stream);
    stream.closed = true;
    for (const f of stream.frames) {
      f.source.onended = null;
      try {
        f.source.stop();
        f.source.disconnect();
      } catch {
      }
    }
    stream.frames = [];
    stream.cues = [];
    for (const timer of this.timers.get(stream.id) ?? []) clearTimeout(timer);
    this.timers.delete(stream.id);
    if (notify && this.connected) this.send({ type: "playback", turnId: stream.turnId, streamId: stream.id, state: "cleared", playedSamples: played, bufferedSamples: 0 });
    this.prune();
  }
  clearAudio(notify) {
    for (const stream of this.streams.values()) this.clearStream(stream, notify);
    this.clearCueTimers();
  }
  clearCueTimers() {
    for (const timers of this.timers.values()) for (const timer of timers) clearTimeout(timer);
    this.timers.clear();
  }
  prune() {
    for (const [id, s] of this.streams) if (s.closed) this.streams.delete(id);
  }
};
function renderSurface(container, client2) {
  const components = /* @__PURE__ */ new Map(), nodes = /* @__PURE__ */ new Map(), expiry = /* @__PURE__ */ new Map();
  const remove = (id) => {
    components.delete(id);
    nodes.get(id)?.remove();
    nodes.delete(id);
    clearTimeout(expiry.get(id));
    expiry.delete(id);
  };
  const disabled = (node, c) => {
    for (const input of node.querySelectorAll("button,input,select")) input.disabled = input.classList.contains("voice-dismiss") ? !client2.connected : !client2.connected || client2.busy || c.disabled || c.expiresAt <= client2.serverNow();
  };
  const render = (c) => {
    if (c.expiresAt <= client2.serverNow()) {
      remove(c.id);
      return;
    }
    const previous = components.get(c.id);
    if (previous && previous.revision > c.revision) return;
    remove(c.id);
    components.set(c.id, c);
    const card = document.createElement("article");
    card.className = "voice-card";
    card.dataset.componentId = c.id;
    const heading = document.createElement("h3");
    heading.textContent = c.title;
    card.append(heading);
    if (c.text) {
      const body = document.createElement("p");
      body.textContent = c.text;
      card.append(body);
    }
    if (c.rows) {
      const rows = document.createElement("dl");
      for (const row of c.rows) {
        const label = document.createElement("dt"), value = document.createElement("dd");
        label.textContent = row.label;
        value.textContent = row.value;
        rows.append(label, value);
      }
      card.append(rows);
    }
    if (c.type === "progress") {
      const progress = document.createElement("progress");
      progress.max = 1;
      if (c.value !== void 0) progress.value = c.value;
      progress.setAttribute("aria-label", c.title);
      card.append(progress);
    }
    const form = document.createElement("form"), inputs = /* @__PURE__ */ new Map();
    for (const field of c.fields ?? []) {
      const label = document.createElement("label");
      label.textContent = field.label;
      let input;
      if (field.type === "select") {
        const select = document.createElement("select"), empty = document.createElement("option");
        empty.value = "";
        empty.textContent = "\u8BF7\u9009\u62E9";
        select.append(empty);
        for (const option of field.options) {
          const o = document.createElement("option");
          o.value = option.value;
          o.textContent = option.label;
          select.append(o);
        }
        input = select;
      } else {
        const entry = document.createElement("input");
        entry.type = field.type === "boolean" ? "checkbox" : field.type === "number" ? "number" : "text";
        entry.maxLength = 256;
        if (field.min !== void 0) entry.min = String(field.min);
        if (field.max !== void 0) entry.max = String(field.max);
        if (field.type === "number") entry.step = "any";
        input = entry;
      }
      input.required = field.required;
      input.name = field.id;
      inputs.set(field.id, input);
      label.append(input);
      form.append(label);
    }
    const error2 = document.createElement("p");
    error2.className = "voice-error";
    error2.setAttribute("role", "status");
    const invoke = (actionId) => {
      try {
        if (!form.reportValidity()) return;
        const values = /* @__PURE__ */ Object.create(null);
        for (const field of c.fields ?? []) {
          const input = inputs.get(field.id);
          if (field.type === "boolean") values[field.id] = input.checked;
          else if (input.value !== "") values[field.id] = field.type === "number" ? Number(input.value) : input.value;
        }
        client2.action(c, actionId, values);
        for (const button of form.querySelectorAll("button")) button.disabled = true;
      } catch (e) {
        error2.textContent = e instanceof Error ? e.message : String(e);
      }
    };
    for (const action of c.actions ?? []) {
      const button = document.createElement("button");
      button.textContent = action.label;
      button.type = c.type === "form" ? "submit" : "button";
      if (c.type !== "form") button.onclick = () => invoke(action.id);
      form.append(button);
    }
    form.onsubmit = (event2) => {
      event2.preventDefault();
      if (c.actions?.[0]) invoke(c.actions[0].id);
    };
    card.append(form, error2);
    const close = document.createElement("button");
    close.textContent = "\u5173\u95ED";
    close.className = "voice-dismiss";
    close.onclick = () => {
      try {
        client2.dismiss(c);
      } catch (e) {
        error2.textContent = String(e);
      }
    };
    card.append(close);
    container.append(card);
    nodes.set(c.id, card);
    disabled(card, c);
    expiry.set(c.id, setTimeout(() => remove(c.id), Math.max(0, c.expiresAt - client2.serverNow())));
  };
  const event = (e) => {
    const m = e.detail;
    if (m.type === "ui.snapshot") {
      for (const id of [...components.keys()]) remove(id);
      for (const c of m.components) render(c);
    }
    if (m.type === "ui.render") render(m.component);
    if (m.type === "ui.remove") {
      const current = components.get(m.componentId);
      if (!current || m.revision >= current.revision) remove(m.componentId);
    }
    if (m.type === "error") for (const node of nodes.values()) node.querySelector(".voice-error").textContent = m.message;
    for (const [id, c] of components) disabled(nodes.get(id), c);
  };
  const connection = () => {
    for (const [id, c] of components) disabled(nodes.get(id), c);
  };
  client2.addEventListener("event", event);
  client2.addEventListener("connection", connection);
  return () => {
    client2.removeEventListener("event", event);
    client2.removeEventListener("connection", connection);
    for (const id of [...components.keys()]) remove(id);
  };
}

// examples/avatar-client.ts
var $ = (id) => document.getElementById(id);
var client = new VoiceClient();
var avatar = $("avatar");
renderSurface($("surface"), client);
$("endpoint").value = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/voice`;
var expressionTimer;
var gestureTimer;
var reset = () => {
  clearTimeout(expressionTimer);
  clearTimeout(gestureTimer);
  avatar.dataset.expression = "neutral";
  delete avatar.dataset.gesture;
};
var error = (e) => {
  $("error").textContent = e instanceof Error ? e.message : String(e);
};
function buttons() {
  $("send").disabled = !client.connected || client.busy;
  $("cancel").disabled = !client.connected || !client.busy;
  $("stop").disabled = !client.connected || !client.busy;
}
client.addEventListener("connection", () => {
  $("connection").textContent = client.connected ? "\u5DF2\u8FDE\u63A5" : "\u5C1A\u672A\u8FDE\u63A5";
  if (!client.connected) {
    reset();
    avatar.dataset.state = "idle";
    $("state").textContent = "\u7A7A\u95F2";
  }
  buttons();
});
client.addEventListener("client.error", (event) => error(event.detail.message));
client.addEventListener("reset", reset);
client.addEventListener("cue", (event) => {
  const cue = event.detail;
  if (cue.expression) {
    clearTimeout(expressionTimer);
    avatar.dataset.expression = cue.expression;
    expressionTimer = setTimeout(() => avatar.dataset.expression = "neutral", cue.durationMs);
  }
  if (cue.gesture) {
    clearTimeout(gestureTimer);
    delete avatar.dataset.gesture;
    void avatar.getBoundingClientRect();
    avatar.dataset.gesture = cue.gesture;
    gestureTimer = setTimeout(() => delete avatar.dataset.gesture, cue.durationMs);
  }
});
client.addEventListener("event", (event) => {
  const m = event.detail;
  if (m.type === "presentation.state") {
    avatar.dataset.state = m.state;
    $("state").textContent = { idle: "\u7A7A\u95F2", listening: "\u503E\u542C", thinking: "\u601D\u8003", speaking: "\u8BF4\u8BDD", error: "\u9047\u5230\u95EE\u9898" }[m.state] ?? m.state;
  }
  if (m.type === "turn.start") {
    $("transcript").textContent = "";
    $("error").textContent = "";
  }
  if (m.type === "llm" && m.state === "delta") $("transcript").textContent += m.text;
  if (m.type === "error") error(m.message);
  if (!["pong", "playback.ack"].includes(m.type)) {
    const log = $("events");
    log.textContent = (log.textContent + `${m.type}${m.state ? " \xB7 " + m.state : ""}
`).split("\n").slice(-80).join("\n");
  }
  buttons();
});
$("connect").onclick = async () => {
  try {
    $("connect").disabled = true;
    $("error").textContent = "";
    await client.connect($("endpoint").value, $("token").value, $("device").value);
  } catch (e) {
    error(e);
  } finally {
    $("connect").disabled = false;
  }
};
$("disconnect").onclick = () => client.disconnect();
$("send").onclick = () => {
  try {
    client.query($("query").value);
  } catch (e) {
    error(e);
  }
};
$("cancel").onclick = () => {
  try {
    client.cancel();
  } catch (e) {
    error(e);
  }
};
$("stop").onclick = () => {
  try {
    client.stopSpeech();
  } catch (e) {
    error(e);
  }
};
window.addEventListener("pagehide", () => client.disconnect());
