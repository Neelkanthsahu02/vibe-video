import React, { useState } from "react";
import type { ChannelInfo, ProjectInfo } from "../../../src/desktop/api-types.js";

interface Props {
  channels: ChannelInfo[];
  onClose: () => void;
  onCreated: (info: ProjectInfo) => void;
}

export const CreateProjectModal: React.FC<Props> = ({
  channels,
  onClose,
  onCreated,
}) => {
  const [name, setName] = useState("");
  const [channelSlug, setChannelSlug] = useState(
    channels[0]?.slug ?? "",
  );
  const [scriptMode, setScriptMode] = useState<"text" | "path">("text");
  const [scriptText, setScriptText] = useState("");
  const [scriptPath, setScriptPath] = useState<string | null>(null);
  const [voiceoverPath, setVoiceoverPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pickScript = async () => {
    const r = await window.vibe.pickFile("Choose script.txt", [
      { name: "Text", extensions: ["txt", "md"] },
    ]);
    if (!r.cancelled && r.path) {
      setScriptPath(r.path);
      setScriptMode("path");
    }
  };
  const pickVoiceover = async () => {
    const r = await window.vibe.pickFile("Choose voiceover", [
      { name: "Audio", extensions: ["wav", "mp3", "m4a", "flac"] },
    ]);
    if (!r.cancelled && r.path) setVoiceoverPath(r.path);
  };

  const submit = async () => {
    setErr(null);
    if (!name.trim()) return setErr("Name is required");
    if (!channelSlug) return setErr("Pick a channel Style Library");
    if (!voiceoverPath) return setErr("Pick a voiceover file");
    if (scriptMode === "path" && !scriptPath) return setErr("Pick a script file");
    if (scriptMode === "text" && !scriptText.trim())
      return setErr("Paste a script");
    setBusy(true);
    try {
      const info = await window.vibe.createProject({
        name: name.trim(),
        channelSlug,
        scriptSource:
          scriptMode === "text"
            ? { kind: "text", text: scriptText }
            : { kind: "path", path: scriptPath! },
        voiceoverSource: { kind: "path", path: voiceoverPath },
      });
      onCreated(info);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>New project</h2>
        {err ? <div className="warning-banner">{err}</div> : null}

        <div className="field">
          <label>Project name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="khloe-tristan-timeline"
            autoFocus
          />
        </div>

        <div className="field">
          <label>Channel Style Library</label>
          <select
            value={channelSlug}
            onChange={(e) => setChannelSlug(e.target.value)}
          >
            <option value="">— pick one —</option>
            {channels.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name} ({c.videoCount} videos)
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Script</label>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button
              onClick={() => setScriptMode("text")}
              className={scriptMode === "text" ? "primary" : ""}
            >
              Paste text
            </button>
            <button
              onClick={pickScript}
              className={scriptMode === "path" ? "primary" : ""}
            >
              Choose file
            </button>
            {scriptMode === "path" && scriptPath ? (
              <span style={{ alignSelf: "center", color: "var(--muted)" }}>
                {shorten(scriptPath)}
              </span>
            ) : null}
          </div>
          {scriptMode === "text" ? (
            <textarea
              value={scriptText}
              onChange={(e) => setScriptText(e.target.value)}
              placeholder="Paste the full narration script here…"
            />
          ) : null}
        </div>

        <div className="field">
          <label>Voiceover</label>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={pickVoiceover}>Choose audio file</button>
            {voiceoverPath ? (
              <span style={{ alignSelf: "center", color: "var(--muted)" }}>
                {shorten(voiceoverPath)}
              </span>
            ) : null}
          </div>
        </div>

        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={submit} disabled={busy}>
            {busy ? "Creating…" : "Create project"}
          </button>
        </div>
      </div>
    </div>
  );
};

function shorten(p: string): string {
  if (p.length < 50) return p;
  const parts = p.split(/[\\/]/);
  return `…/${parts.slice(-2).join("/")}`;
}
