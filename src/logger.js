function stringifyMeta(meta = {}) {
  try {
    return JSON.stringify(meta);
  } catch {
    return JSON.stringify({ message: "meta_serialization_failed" });
  }
}

export function log(level, message, meta = {}) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    message,
    ...meta,
  };
  const line = stringifyMeta(payload);
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}
