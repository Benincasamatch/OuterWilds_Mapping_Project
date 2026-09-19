// Tiny WebGL2 helpers. Functional, allocation-free at draw time, no classes.
//
// Every factory returns a plain object literal:
//   createProgram -> { program, u }        u = { <uniformName>: WebGLUniformLocation|null }
//   createBuffer  -> { buffer, target, byteLength }
//   createVAO     -> { vao, index, attributes }
//
// Attribute locations are declared in the shaders (`layout(location = N)`), so no
// getAttribLocation round-trip is needed here.

/** Numbered source dump used by the compile-error report. */
function numbered(src) {
  const lines = src.split('\n');
  const pad = String(lines.length).length;
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    out.push(String(i + 1).padStart(pad, ' ') + ' | ' + lines[i]);
  }
  return out.join('\n');
}

function firstLine(text) {
  const i = text.indexOf('\n');
  return i < 0 ? text : text.slice(0, i);
}

/**
 * Compile one shader stage. On failure: console.error with the driver log plus the
 * full numbered source, then throw.
 */
export function createShader(gl, type, src) {
  const kind = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
  const shader = gl.createShader(type);
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || '(no info log)';
    console.error('[render/gl] ' + kind + ' shader compile failed:\n' + log + '\n' + numbered(src));
    gl.deleteShader(shader);
    throw new Error(kind + ' shader compile failed: ' + firstLine(log));
  }
  return shader;
}

/**
 * Link a program and collect its ACTIVE uniforms into `u` (plain object, stable
 * shape). Names that the compiler drops come back as `null`, which is a legal
 * no-op for every gl.uniform* call.
 */
export function createProgram(gl, vsSrc, fsSrc) {
  const vs = createShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.detachShader(program, vs);
  gl.detachShader(program, fs);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) || '(no info log)';
    console.error(
      '[render/gl] program link failed:\n' + log +
      '\n--- vertex ---\n' + numbered(vsSrc) +
      '\n--- fragment ---\n' + numbered(fsSrc)
    );
    gl.deleteProgram(program);
    throw new Error('program link failed: ' + firstLine(log));
  }
  const u = {};
  const n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(program, i);
    if (!info) continue;
    const name = info.name.endsWith('[0]') ? info.name.slice(0, -3) : info.name;
    u[name] = gl.getUniformLocation(program, info.name);
  }
  return { program, u };
}

export function destroyProgram(gl, p) {
  if (!p) return;
  if (p.program) gl.deleteProgram(p.program);
  p.program = null;
  p.u = null;
}

/** Upload a typed array into a fresh buffer. */
export function createBuffer(gl, target, data, usage) {
  const buffer = gl.createBuffer();
  const use = usage === undefined ? gl.STATIC_DRAW : usage;
  gl.bindBuffer(target, buffer);
  gl.bufferData(target, data, use);
  gl.bindBuffer(target, null);
  return { buffer, target, byteLength: data.byteLength };
}

/**
 * Re-upload into an existing buffer.
 * `srcLength > 0` uses the WebGL2 srcData/srcOffset/length overload so callers can
 * push a prefix of a preallocated array without slicing it (no per-frame garbage).
 */
export function updateBuffer(gl, buf, data, dstByteOffset, srcOffset, srcLength) {
  const dst = dstByteOffset === undefined ? 0 : dstByteOffset;
  gl.bindBuffer(buf.target, buf.buffer);
  if (srcLength > 0) gl.bufferSubData(buf.target, dst, data, srcOffset | 0, srcLength);
  else gl.bufferSubData(buf.target, dst, data);
  gl.bindBuffer(buf.target, null);
}

export function destroyBuffer(gl, b) {
  if (!b) return;
  if (b.buffer) gl.deleteBuffer(b.buffer);
  b.buffer = null;
}

function handleOf(b) {
  return b && b.buffer !== undefined ? b.buffer : b;
}

/**
 * Build a VAO from a declarative spec:
 *   {
 *     index?: bufferObj | WebGLBuffer,
 *     attributes: [{ location, buffer, size, type?, normalized?, integer?, stride?, offset?, divisor? }]
 *   }
 */
export function createVAO(gl, spec) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const attrs = spec.attributes;
  for (let i = 0; i < attrs.length; i++) {
    const a = attrs[i];
    gl.bindBuffer(gl.ARRAY_BUFFER, handleOf(a.buffer));
    const type = a.type === undefined ? gl.FLOAT : a.type;
    const stride = a.stride === undefined ? 0 : a.stride;
    const offset = a.offset === undefined ? 0 : a.offset;
    if (a.integer === true) gl.vertexAttribIPointer(a.location, a.size, type, stride, offset);
    else gl.vertexAttribPointer(a.location, a.size, type, a.normalized === true, stride, offset);
    gl.enableVertexAttribArray(a.location);
    const divisor = a.divisor === undefined ? 0 : a.divisor;
    if (divisor > 0) gl.vertexAttribDivisor(a.location, divisor);
  }
  if (spec.index) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, handleOf(spec.index));
  gl.bindVertexArray(null);
  return { vao, index: spec.index || null, attributes: attrs.length };
}

export function destroyVAO(gl, v) {
  if (!v) return;
  if (v.vao) gl.deleteVertexArray(v.vao);
  v.vao = null;
}
