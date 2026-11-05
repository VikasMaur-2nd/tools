//! The skeleton of a JSON document of any size (huge.wasm, built with `pnpm wasm:huge`): what huge-file mode
//! reads a file with (see ../../skeleton.ts). It checks that the document is strict JSON (one value, or many:
//! JSON Lines) and counts it, but writes no nodes: memory stays what the window and the open containers take,
//! whatever the size of the document.
//!
//! Input comes in windows of bytes (UTF-8), one after the other, never read twice: everything a window leaves
//! open (a string, an escape, a number, a \r\n) carries over to the next, so a string longer than a window
//! costs nothing more. Each window is parsed in two stages as in ../../../json/wasm/src/lib.rs (tape.wasm):
//! stage 1 classifies 64 bytes at a time with SIMD and lists where tokens start (keeping, per 64 bytes, what
//! turns byte offsets into UTF-16 offsets and line numbers); stage 2 walks the tokens with a stack of the open
//! containers.
//!
//! What it gives back, in buffers JS copies after each window:
//! - checkpoints (about every `ck_every` bytes, after a value): the parser's state there, so a parse can start
//!   again from it (restore()), and the open containers that changed since the previous checkpoint;
//! - the directory: every value of at least `big` bytes (containers and strings), with its span and counts;
//! - warnings: property names seen twice in one object (a bounded check: see DUP_CAP);
//! - on failure, the byte where the document stops being strict JSON (JS finds out what is wrong there).
//!
//! A parse can also stop before a given child of a container (target()): that is how a view seeks "item N".
#![no_std]
#![allow(static_mut_refs, clippy::missing_safety_doc)]

use core::arch::wasm32::*;

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

extern "C" {
    static __heap_base: u8;
}

// Kinds, as in tape.ts.
const STR: u64 = 3;
const ARR: u64 = 4;
const OBJ: u64 = 5;

// run() results.
const DONE: i32 = 0;
const NEED: i32 = 1;
const STOP: i32 = 2;
const FAIL: i32 = -1;

// Why it failed (why()).
const W_SYNTAX: u32 = 1;
const W_DEPTH: u32 = 2;
const W_MEMORY: u32 = 3;
const W_END: u32 = 4;
// Why it stopped: before a child of the target container, or at its closing bracket.
const W_CHILD: u32 = 5;
const W_CLOSE: u32 = 6;
/** Stopped after a value, at the first comma, bracket or top-level value at or after the `after` byte (see target()). */
const W_AFTER: u32 = 7;

// What stage 2 expects next.
const S_VALUE: u64 = 0;
const S_ARR_FIRST: u64 = 1;
const S_OBJ_FIRST: u64 = 2;
const S_KEY: u64 = 3;
const S_COLON: u64 = 4;
const S_AFTER: u64 = 5;
/** After a top-level value: another one (JSON Lines) or the end. */
const S_TOP: u64 = 6;

// A token the window cut, carried over to the next.
const P_NONE: u32 = 0;
const P_STR: u32 = 1;
const P_KEY: u32 = 2;
const P_SCALAR: u32 = 3;

const ODD: u64 = 0xAAAA_AAAA_AAAA_AAAA;
const NONE: u64 = u64::MAX;

/// Bytes that can follow a number or literal: whitespace, brackets, comma, colon, quote.
static ENDS: [bool; 256] = {
    let mut t = [false; 256];
    let mut k = 0;
    let ends = b" \n\r\t,:\"{}[]";
    while k < ends.len() {
        t[ends[k] as usize] = true;
        k += 1;
    }
    t
};

/**
 * u64 per open container: kind, children so far, start byte, its current member's name (byte of its quote),
 * nodes and closing lines before it, object serial, base in the duplicate check's name stack, and for the
 * duplicate check's shortcut: the names matched so far of the last object at its depth (NONE: not matching),
 * and whether its names are being kept (0) for the next object there.
 */
const FR: usize = 10;
/** f64 per frame in checkpoints and snapshots: kind, children, start, key, nodes before, closing lines before. */
const FW: usize = 6;
/** f64 before the frames in a checkpoint or snapshot (see snap()). */
const HW: usize = 15;
/** f64 per directory record (see dir_out()). */
const DW: usize = 10;

/**
 * The duplicate check's shortcut (as tape.wasm guesses names): an object whose names so far are, in order, the
 * names of the last duplicate-free object at its depth has no duplicates so far, and isn't hashed. Kept per depth
 * below SEQ_DEPTH: up to SEQ_NAMES names of SEQ_BYTES in all, without escapes.
 */
const SEQ_DEPTH: usize = 64;
const SEQ_NAMES: usize = 16;
const SEQ_BYTES: usize = 1024;
/** Bytes of one kept sequence: count, offsets, positions, names. */
const SEQ_SLOT: usize = 8 + (SEQ_NAMES + 1) * 4 + SEQ_NAMES * 8 + SEQ_BYTES + 8;
const SEQ_POS: usize = 8 + (SEQ_NAMES + 1) * 4 + 4;
const SEQ_TEXT: usize = SEQ_POS + SEQ_NAMES * 8;
/** Names remembered per object for the duplicate check (later names are still checked against them). */
const DUP_CAP: u64 = 4096;
/** Names remembered in all open objects together. */
const DUP_ALL: usize = 1 << 18;
/** Duplicate names reported (as the parsers: MAX_WARN). */
const MAX_WARN: usize = 500;
/** A name the window cuts is kept up to this many bytes for the duplicate check (a longer one isn't checked). */
const CARRY_CAP: usize = 4096;
/** A name with escapes is checked only up to this many bytes. */
const ESC_CAP: usize = 1 << 16;

// ── Memory: a bump allocator (reset by init) ────────────────────────────────

static mut TOP: usize = 0;

#[cold]
#[inline(never)]
unsafe fn alloc(bytes: usize) -> usize {
    let p = (TOP + 15) & !15;
    let end = p + bytes;
    let have = memory_size(0) * 65536;
    if end > have && memory_grow(0, (end - have).div_ceil(65536)) == usize::MAX {
        return 0;
    }
    TOP = end;
    p
}

/// A growable array of f64 (copied on growth).
#[derive(Clone, Copy)]
struct Out {
    p: usize,
    len: usize,
    cap: usize,
}

impl Out {
    const fn new() -> Out {
        Out { p: 0, len: 0, cap: 0 }
    }
    #[cold]
    #[inline(never)]
    unsafe fn grow(&mut self, extra: usize) -> bool {
        let mut cap = if self.cap < 256 { 256 } else { self.cap * 2 };
        while cap < self.len + extra {
            cap *= 2;
        }
        let p = alloc(cap * 8);
        if p == 0 {
            return false;
        }
        core::ptr::copy_nonoverlapping(self.p as *const u8, p as *mut u8, self.len * 8);
        self.p = p;
        self.cap = cap;
        true
    }
    #[inline(always)]
    unsafe fn reserve(&mut self, extra: usize) -> bool {
        self.len + extra <= self.cap || self.grow(extra)
    }
    #[inline(always)]
    unsafe fn put(&mut self, v: f64) {
        *(self.p as *mut f64).add(self.len) = v;
        self.len += 1;
    }
}

// ── State ────────────────────────────────────────────────────────────────

// Settings (init).
static mut FLAGS: u32 = 0;
const F_CHECKPOINTS: u32 = 1;
const F_DUPS: u32 = 2;
const F_DIR: u32 = 4;
/** JSON Lines (the file's name says so): separators after a single top-level value are fine (tape-parser.ts `lines`). */
const F_LINES: u32 = 8;
static mut CK_EVERY: u64 = 1 << 20;
static mut BIG: u64 = 1 << 18;
static mut MAX_DEPTH: u64 = 100_000;

// The window: WLEN bytes at WIN (+ 128 bytes of spaces), from byte POS0 of the document.
static mut WIN: usize = 0;
static mut WCAP: usize = 0;
static mut WLEN: usize = 0;
static mut FINAL: bool = false;
static mut ASCII: bool = true;
// Stage 1: token starts (window offsets), and per 64 bytes: UTF-16 units before them, the bytes that start a
// character, those that start a 4-byte one, line breaks before them, and the bytes that start a line break.
static mut IDX: usize = 0;
static mut NIDX: usize = 0;
static mut BASE: usize = 0;
static mut NONC: usize = 0;
static mut FOUR: usize = 0;
static mut BRKB: usize = 0;
static mut BRK: usize = 0;
/** The window's first byte that isn't strict JSON whatever its tokens are (a control character, a bad escape): window offset, or usize::MAX. */
static mut FAIL_AT: usize = usize::MAX;
// What the window adds up to (applied once it is done): UTF-16 units, line breaks, the last break's offset.
static mut W_UNITS: u64 = 0;
static mut W_BREAKS: u64 = 0;
static mut W_LAST_BRK: usize = usize::MAX;
// Stage 1's state at the end of the window (the next one starts from it).
static mut C_IN: u64 = 0;
static mut C_ESC: u64 = 0;
static mut C_UC: u64 = 0;
static mut C_PS: u64 = 0;
static mut C_CR: u64 = 0;
// Where the window is in the document: its first byte, UTF-16 units and line breaks before it, and the
// UTF-16 offset of the start of the line it starts in.
static mut POS0: u64 = 0;
static mut U16_0: u64 = 0;
static mut LINES0: u64 = 0;
static mut LINE_U16: u64 = 0;

// Stage 2.
static mut II: usize = 0;
static mut STATE: u64 = S_VALUE;
static mut DEPTH: usize = 0;
static mut STACK: usize = 0;
static mut SCAP: usize = 0;
/** Top-level values so far (the children count of the top level). */
static mut TOPN: u64 = 0;
static mut NODES: u64 = 0;
/** Closing lines so far: containers with children that closed (each is a line of the pretty form). */
static mut CLOSERS: u64 = 0;
/** The deepest closing container (with children) since the last checkpoint (or restore); DEEP_ALL: before it. */
static mut DEEPEST: u64 = 0;
static mut DEEP_ALL: u64 = 0;
/** The lowest depth since the last checkpoint (frames below it haven't changed). */
static mut LOW: usize = 0;
static mut NEXT_CK: u64 = 0;
static mut WHY: u32 = 0;
static mut FAIL_POS: u64 = 0;
/** At FAIL_POS: UTF-16 units before it, line breaks before it, the UTF-16 offset of its line's start. */
static mut FAIL_AT_U16: [f64; 3] = [0.0; 3];
// The token the window cut: what it is, where it starts, and a number's or literal's state so far.
static mut PART: u32 = P_NONE;
static mut PSTART: u64 = 0;
static mut PDFA: u32 = 0;
// A name the window cut, for the duplicate check (CARRY_CAP bytes; NONE: too long, not checked).
static mut CARRY: usize = 0;
static mut CARRY_LEN: usize = 0;
// JSON Lines: whether each top-level value is on lines of its own (no value spans a line break, none shares one).
static mut LINES_OK: bool = true;
static mut LAST_TOP_LINE: u64 = NONE;
static mut TOP_LINE: u64 = 0;
/** The first `,` or `;` between top-level values (JSON Lines may have them: tape-parser.ts nextLine), or NONE. */
static mut SEP: u64 = NONE;
/** Where the second top-level value starts (the normal path's "Multiple top-level values" notice), or NONE. */
static mut SECOND: u64 = NONE;
// The same facts since the last checkpoint, in it (so an edit can tell what a stretch of the document holds):
// whether its top-level values were on lines of their own, its first separator between them.
static mut LOK: bool = true;
static mut LSEP: u64 = NONE;

// Target (see target()).
static mut T_DEPTH: usize = usize::MAX;
static mut T_START: u64 = NONE;
static mut T_COUNT: u64 = NONE;
static mut T_BYTE: u64 = NONE;
static mut T_VAL: u64 = NONE;
static mut T_AFTER: u64 = NONE;

// Output.
static mut CK: Out = Out::new();
static mut DIR: Out = Out::new();
static mut WARN: Out = Out::new();
static mut WARNS: usize = 0;
static mut SNAP: Out = Out::new();
static mut STATS: [f64; 19] = [0.0; 19];

// The duplicate check: the open objects' names (tag, byte of the name; innermost object last), where a tag
// mixes the name's hash with its object's serial; and for objects with more than SMALL names, an
// open-addressing table of them (tag 0: empty).
static mut DTAB: usize = 0;
static mut DMASK: usize = 0;
static mut DLIVE: usize = 0;
static mut DSTACK: usize = 0;
static mut DSCAP: usize = 0;
static mut DSLEN: usize = 0;
static mut SERIAL: u64 = 0;
/** Names not checked (cut by a window and too long, or written with escapes and too long, or past DUP_ALL). */
static mut DUP_SKIPPED: u64 = 0;
static mut SCRATCH: usize = 0;
/** The shortcut's sequences: per depth, the last duplicate-free object's names and the open object's. */
static mut SEQ: usize = 0;
static mut SCRATCH_CAP: usize = 0;

/// Starts a parse. `wcap`: window bytes (a multiple of 64); `flags`: 1 checkpoints, 2 duplicate names, 4 the
/// directory, 8 JSON Lines; `ck_every`: bytes between checkpoints; `big`: the size from which a value is in the directory;
/// `max_depth`: deepest nesting (parser.ts MAX_DEPTH). Returns 0 if out of memory.
#[no_mangle]
pub unsafe extern "C" fn init(wcap: usize, flags: u32, ck_every: f64, big: f64, max_depth: u32) -> u32 {
    TOP = &__heap_base as *const u8 as usize;
    FLAGS = flags;
    CK_EVERY = ck_every as u64;
    BIG = big as u64;
    MAX_DEPTH = max_depth as u64;
    CK = Out::new();
    DIR = Out::new();
    WARN = Out::new();
    SNAP = Out::new();
    WARNS = 0;
    DUP_SKIPPED = 0;
    SCAP = 64;
    STACK = alloc(SCAP * FR * 8);
    CARRY = alloc(CARRY_CAP + 16);
    SCRATCH_CAP = 4096;
    SCRATCH = alloc(SCRATCH_CAP + 16);
    DTAB = 0;
    DMASK = 0;
    DLIVE = 0;
    DSCAP = 0;
    DSLEN = 0;
    DSTACK = 0;
    if flags & F_DUPS != 0 {
        DMASK = 1023;
        DTAB = alloc(1024 * 16);
        SEQ = alloc(SEQ_DEPTH * 2 * SEQ_SLOT);
        if SEQ == 0 {
            return 0;
        }
        core::ptr::write_bytes(SEQ as *mut u8, 0, SEQ_DEPTH * 2 * SEQ_SLOT);
        DSCAP = 1024;
        DSTACK = alloc(DSCAP * 16);
        if DTAB == 0 || DSTACK == 0 {
            return 0;
        }
        core::ptr::write_bytes(DTAB as *mut u8, 0, 1024 * 16);
    }
    if STACK == 0 || CARRY == 0 || SCRATCH == 0 {
        return 0;
    }
    let blocks = wcap / 64 + 2;
    WIN = alloc(wcap + 128);
    IDX = alloc((wcap + 64 + 16) * 4);
    BASE = alloc(blocks * 4);
    NONC = alloc(blocks * 8);
    FOUR = alloc(blocks * 8);
    BRKB = alloc(blocks * 4);
    BRK = alloc(blocks * 8);
    if WIN == 0 || IDX == 0 || BASE == 0 || NONC == 0 || FOUR == 0 || BRKB == 0 || BRK == 0 {
        return 0;
    }
    WCAP = wcap;
    reset_stage1();
    W_UNITS = 0;
    W_BREAKS = 0;
    W_LAST_BRK = usize::MAX;
    SPLIT = usize::MAX;
    POS0 = 0;
    U16_0 = 0;
    LINES0 = 0;
    LINE_U16 = 0;
    II = 0;
    NIDX = 0;
    WLEN = 0;
    FINAL = false;
    STATE = S_VALUE;
    DEPTH = 0;
    TOPN = 0;
    NODES = 0;
    CLOSERS = 0;
    DEEPEST = 0;
    DEEP_ALL = 0;
    LOW = 0;
    NEXT_CK = if flags & F_CHECKPOINTS != 0 { CK_EVERY } else { NONE };
    WHY = 0;
    FAIL_POS = 0;
    PART = P_NONE;
    LINES_OK = true;
    LAST_TOP_LINE = NONE;
    TOP_LINE = 0;
    SEP = NONE;
    SECOND = NONE;
    LOK = true;
    LSEP = NONE;
    SERIAL = 0;
    T_DEPTH = usize::MAX;
    T_COUNT = NONE;
    T_BYTE = NONE;
    1
}

unsafe fn reset_stage1() {
    C_IN = 0;
    C_ESC = 0;
    C_UC = 0;
    C_PS = 0;
    C_CR = 0;
    FAIL_AT = usize::MAX;
}

#[no_mangle]
pub unsafe extern "C" fn win_ptr() -> usize {
    WIN
}
#[no_mangle]
pub unsafe extern "C" fn win_cap() -> usize {
    WCAP
}
/** The document's byte where the next window starts. */
#[no_mangle]
pub unsafe extern "C" fn next_pos() -> f64 {
    POS0 as f64
}
#[no_mangle]
pub unsafe extern "C" fn why() -> u32 {
    WHY
}
#[no_mangle]
pub unsafe extern "C" fn fail_pos() -> f64 {
    FAIL_POS as f64
}
/** [UTF-16 units before fail_pos(), line breaks before it, the UTF-16 offset of its line's start]. */
#[no_mangle]
pub unsafe extern "C" fn fail_info() -> usize {
    FAIL_AT_U16.as_ptr() as usize
}

#[cold]
#[inline(never)]
unsafe fn failed_at(p: usize) {
    FAIL_POS = POS0 + p as u64;
    FAIL_AT_U16 = [(U16_0 + u16_at(p) as u64) as f64, lines_at(p) as f64, line_u16_at(p) as f64];
}
#[no_mangle]
pub unsafe extern "C" fn ck_ptr() -> usize {
    CK.p
}
#[no_mangle]
pub unsafe extern "C" fn ck_len() -> usize {
    CK.len
}
#[no_mangle]
pub unsafe extern "C" fn dir_ptr() -> usize {
    DIR.p
}
#[no_mangle]
pub unsafe extern "C" fn dir_len() -> usize {
    DIR.len
}
#[no_mangle]
pub unsafe extern "C" fn warn_ptr() -> usize {
    WARN.p
}
#[no_mangle]
pub unsafe extern "C" fn warn_len() -> usize {
    WARN.len
}
/** The output buffers were copied: they start again empty. */
#[no_mangle]
pub unsafe extern "C" fn drain() {
    CK.len = 0;
    DIR.len = 0;
    WARN.len = 0;
}

/// Where the parse is: [0] the byte of the next token (or the end of the window), [1] nodes, [2] closing
/// lines, [3] top-level values, [4] deepest nesting, [5] depth, [6] state, [7] whether the top-level values
/// are JSON Lines (each on lines of its own), [8] names the duplicate check skipped, [9] line breaks before
/// [0], [10] UTF-16 units before [0], [11] the UTF-16 offset of the start of that line.
#[no_mangle]
pub unsafe extern "C" fn stats() -> usize {
    let p = if SPLIT != usize::MAX { SPLIT } else if II < NIDX { *(IDX as *const u32).add(II) as usize } else { WLEN };
    let s = &mut STATS;
    s[0] = (POS0 + p as u64) as f64;
    s[1] = NODES as f64;
    s[2] = CLOSERS as f64;
    s[3] = TOPN as f64;
    s[4] = DEEP_ALL.max(DEEPEST) as f64;
    s[5] = DEPTH as f64;
    s[6] = STATE as f64;
    s[7] = LINES_OK as u32 as f64;
    s[8] = DUP_SKIPPED as f64;
    s[9] = lines_at(p) as f64;
    s[10] = (U16_0 + u16_at(p) as u64) as f64;
    s[11] = line_u16_at(p) as f64;
    // The token a window cut (P_*) and its start, the second top-level value's start, the lowest depth since
    // the last checkpoint (or restore).
    s[12] = PART as f64;
    s[13] = if PART != P_NONE { PSTART as f64 } else { -1.0 };
    s[14] = if SECOND == NONE { -1.0 } else { SECOND as f64 };
    s[15] = LOW as f64;
    // The facts since the last checkpoint (see snap()): top-level values on lines of their own, the first
    // separator, the deepest closing container.
    s[16] = LOK as u32 as f64;
    s[17] = if LSEP == NONE { -1.0 } else { LSEP as f64 };
    s[18] = DEEPEST as f64;
    s.as_ptr() as usize
}

/// From now on, stop before child `count` of the container that starts at byte `start` and is innermost at
/// depth `depth` (depth 0: the top level, whatever `start`; 1: the root container...), or before its first child
/// that starts at byte `byte` or later (an object's member: its name), or before its child whose value starts at
/// byte `val` (an object's member: after its name), or at its closing bracket. depth -1: no target.
#[no_mangle]
pub unsafe extern "C" fn target(depth: i32, start: f64, count: f64, byte: f64, val: f64) {
    T_AFTER = NONE;
    T_DEPTH = if depth < 0 { usize::MAX } else { depth as usize };
    T_START = start as u64;
    T_COUNT = if count < 0.0 { NONE } else { count as u64 };
    T_BYTE = if byte < 0.0 { NONE } else { byte as u64 };
    T_VAL = if val < 0.0 { NONE } else { val as u64 };
}

/// From now on (with target()'s), stop after a value: at the first comma, closing bracket or next top-level
/// value at or after byte `after` (a clean place to end a stretch of the document: see snap()). -1: none.
#[no_mangle]
pub unsafe extern "C" fn stop_after(after: f64) {
    T_AFTER = if after < 0.0 { NONE } else { after as u64 };
}

// ── Stage 1 ──────────────────────────────────────────────────────────────

#[inline(always)]
unsafe fn eqm(v: v128, c: u8) -> u64 {
    i8x16_bitmask(i8x16_eq(v, u8x16_splat(c))) as u64
}

#[inline(always)]
unsafe fn eqm2(a: v128, b: v128) -> u64 {
    i8x16_bitmask(i8x16_eq(a, b)) as u64
}

/// By low 4 bits: { } (| 0x20 also [ ]), : and ,.
const OPS: v128 = u8x16(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, b':', b'{', b',', b'}', 0, 0);
/// By low 4 bits: space, tab, line feed, carriage return.
const WS: v128 = u8x16(b' ', 0, 0, 0, 0, 0, 0, 0, 0, b'\t', b'\n', 0, 0, b'\r', 0, 0);

#[inline(always)]
fn m4<F: Fn(v128) -> u64>(v: &[v128; 4], f: F) -> u64 {
    f(v[0]) | (f(v[1]) << 16) | (f(v[2]) << 32) | (f(v[3]) << 48)
}

#[inline(always)]
fn prefix_xor(mut x: u64) -> u64 {
    x ^= x << 1;
    x ^= x << 2;
    x ^= x << 4;
    x ^= x << 8;
    x ^= x << 16;
    x ^= x << 32;
    x
}

/// Bits below `bit` (0..=64).
#[inline(always)]
fn below(bit: usize) -> u64 {
    if bit >= 64 {
        !0
    } else {
        (1u64 << bit) - 1
    }
}

/// Takes the `len` bytes written at the window (`last` 1 if they end the document; else `len` is a multiple
/// of 64) and runs stage 1. Returns 0.
#[no_mangle]
pub unsafe extern "C" fn load(len: usize, last: u32) -> i32 {
    WLEN = len;
    FINAL = last != 0;
    II = 0;
    SPLIT = usize::MAX;
    let inp = WIN;
    core::ptr::write_bytes((inp + len) as *mut u8, b' ', 128);
    let idx = IDX as *mut u32;
    let base = BASE as *mut u32;
    let nonc_t = NONC as *mut u64;
    let four_t = FOUR as *mut u64;
    let brkb = BRKB as *mut u32;
    let brk_t = BRK as *mut u64;
    let blocks = len.div_ceil(64);
    let mut n = 0usize;
    let mut next_escaped = C_ESC;
    let mut prev_in = C_IN;
    let mut prev_scalar = C_PS;
    let mut u_carry = C_UC;
    let mut cr_carry = C_CR;
    let mut units: u32 = 0;
    let mut breaks: u32 = 0;
    let mut last_brk = usize::MAX;
    let mut hi_any: u64 = 0;
    let mut drop_any: u64 = 0;
    let mut fail_at = usize::MAX;
    for b in 0..blocks {
        let p = b * 64;
        let v0 = v128_load((inp + p) as *const v128);
        let v1 = v128_load((inp + p + 16) as *const v128);
        let v2 = v128_load((inp + p + 32) as *const v128);
        let v3 = v128_load((inp + p + 48) as *const v128);
        let vs = [v0, v1, v2, v3];
        let or4 = |f: &dyn Fn(v128) -> v128| v128_any_true(v128_or(v128_or(f(v0), f(v1)), v128_or(f(v2), f(v3))));
        let q = m4(&vs, |v| eqm(v, b'"'));
        let bs = if or4(&|v| i8x16_eq(v, u8x16_splat(b'\\'))) { m4(&vs, |v| eqm(v, b'\\')) } else { 0 };
        let ctl = if or4(&|v| u8x16_lt(v, u8x16_splat(0x20))) { m4(&vs, |v| i8x16_bitmask(u8x16_lt(v, u8x16_splat(0x20))) as u64) } else { 0 };
        let hi = if or4(&|v| v) { m4(&vs, |v| i8x16_bitmask(v) as u64) } else { 0 };
        let inside = prev_in != 0 && q == 0 && bs == 0 && ctl == 0 && next_escaped == 0 && u_carry == 0;
        let (op, ws) = if inside {
            (0, 0)
        } else {
            (
                m4(&vs, |v| {
                    let lo = v128_or(v, u8x16_splat(0x20));
                    eqm2(u8x16_swizzle(OPS, v128_and(lo, u8x16_splat(15))), lo)
                }),
                m4(&vs, |v| eqm2(u8x16_swizzle(WS, v128_and(v, u8x16_splat(15))), v)),
            )
        };
        // Line breaks: a \n after a \r is no break of its own (and no UTF-16 unit: the page keeps \r\n as \n).
        let mut drop = 0u64;
        let mut brk = 0u64;
        if ctl != 0 {
            let nl = m4(&vs, |v| eqm(v, b'\n'));
            // (Most files have no \r: its mask only where there is one.)
            let cr = if or4(&|v| i8x16_eq(v, u8x16_splat(b'\r'))) { m4(&vs, |v| eqm(v, b'\r')) } else { 0 };
            drop = nl & ((cr << 1) | cr_carry);
            brk = (nl & !drop) | cr;
            cr_carry = cr >> 63;
            drop_any |= drop;
        } else {
            cr_carry = 0;
        }
        *base.add(b) = units;
        *brkb.add(b) = breaks;
        *brk_t.add(b) = brk;
        if brk != 0 {
            breaks += brk.count_ones();
            last_brk = p + 63 - brk.leading_zeros() as usize;
        }
        if hi != 0 {
            hi_any |= hi;
            let cont = m4(&vs, |v| i8x16_bitmask(i8x16_lt(v, i8x16_splat(-64))) as u64);
            let four = m4(&vs, |v| i8x16_bitmask(u8x16_ge(v, u8x16_splat(0xF0))) as u64);
            *nonc_t.add(b) = !cont & !drop;
            *four_t.add(b) = four;
            units += (64 - cont.count_ones() - drop.count_ones() + four.count_ones()) as u32;
        } else {
            *nonc_t.add(b) = !drop;
            *four_t.add(b) = 0;
            units += 64 - drop.count_ones();
        }
        // Escaped characters (simdjson's escape scanner).
        let mut escaped = 0u64;
        if bs != 0 || next_escaped != 0 {
            let potential = bs & !next_escaped;
            let maybe = potential << 1;
            let code = ((maybe | ODD).wrapping_sub(potential)) ^ ODD;
            escaped = code ^ (bs | next_escaped);
            next_escaped = (code & bs) >> 63;
        }
        // What follows a backslash must be one of " \ / b f n r t u, and u four hex digits.
        if escaped != 0 || u_carry != 0 {
            let okc = m4(&vs, |v| {
                eqm(v, b'"') | eqm(v, b'\\') | eqm(v, b'/') | eqm(v, b'b') | eqm(v, b'f') | eqm(v, b'n') | eqm(v, b'r') | eqm(v, b't') | eqm(v, b'u')
            });
            let umask = m4(&vs, |v| eqm(v, b'u'));
            let hex = m4(&vs, |v| {
                let d = v128_and(u8x16_ge(v, u8x16_splat(b'0')), u8x16_le(v, u8x16_splat(b'9')));
                let lo = v128_or(v, u8x16_splat(0x20));
                let a = v128_and(u8x16_ge(lo, u8x16_splat(b'a')), u8x16_le(lo, u8x16_splat(b'f')));
                i8x16_bitmask(v128_or(d, a)) as u64
            });
            if escaped & !okc != 0 {
                fail_at = fail_at.min(p + (escaped & !okc).trailing_zeros() as usize);
            }
            let u = escaped & umask;
            let need = (u << 1) | (u << 2) | (u << 3) | (u << 4) | u_carry;
            if need & !hex != 0 {
                fail_at = fail_at.min(p + (need & !hex).trailing_zeros() as usize);
            }
            let t = u >> 60;
            u_carry = (t & 1) | (((t >> 1) & 1) * 3) | (((t >> 2) & 1) * 7) | (((t >> 3) & 1) * 15);
        }
        let quote = q & !escaped;
        let in_str = prefix_xor(quote) ^ prev_in;
        prev_in = ((in_str as i64) >> 63) as u64;
        // Raw control characters: inside strings always wrong, outside only whitespace is allowed.
        let bad = ctl & (in_str | !ws);
        if bad != 0 {
            fail_at = fail_at.min(p + bad.trailing_zeros() as usize);
        }
        let scalar = !(op | ws | quote | in_str);
        let starts = scalar & !((scalar << 1) | prev_scalar);
        prev_scalar = scalar >> 63;
        let mut s = (op & !in_str) | quote | starts;
        let count = s.count_ones() as usize;
        let to = idx.add(n);
        let mut k = 0;
        while k < 8 {
            *to.add(k) = (p + s.trailing_zeros() as usize) as u32;
            s &= s.wrapping_sub(1);
            k += 1;
        }
        if count > 8 {
            while k < 16 {
                *to.add(k) = (p + s.trailing_zeros() as usize) as u32;
                s &= s.wrapping_sub(1);
                k += 1;
            }
            while s != 0 {
                *to.add(k) = (p + s.trailing_zeros() as usize) as u32;
                s &= s - 1;
                k += 1;
            }
        }
        n += count;
    }
    *base.add(blocks) = units;
    *brkb.add(blocks) = breaks;
    // Tokens that start in the padding.
    while n > 0 && *idx.add(n - 1) as usize >= len {
        n -= 1;
    }
    NIDX = n;
    FAIL_AT = if fail_at < len { fail_at } else { usize::MAX };
    ASCII = hi_any == 0 && drop_any == 0;
    W_UNITS = units as u64;
    W_BREAKS = breaks as u64;
    W_LAST_BRK = last_brk;
    C_ESC = next_escaped;
    C_IN = prev_in;
    C_PS = prev_scalar;
    C_UC = u_carry;
    C_CR = cr_carry;
    0
}

/// UTF-16 units from the window's start to window offset `p` (0..=WLEN).
#[inline(always)]
unsafe fn u16_at(p: usize) -> u32 {
    if ASCII {
        return p as u32;
    }
    let b = p >> 6;
    let m = below(p & 63);
    *(BASE as *const u32).add(b) + (*(NONC as *const u64).add(b) & m).count_ones() + (*(FOUR as *const u64).add(b) & m).count_ones()
}

/// Line breaks in the document before window offset `p`.
#[inline(always)]
unsafe fn lines_at(p: usize) -> u64 {
    let b = p >> 6;
    LINES0 + (*(BRKB as *const u32).add(b) + (*(BRK as *const u64).add(b) & below(p & 63)).count_ones()) as u64
}

/// The UTF-16 offset (in the document) of the start of the line window offset `p` is in.
#[cold]
#[inline(never)]
unsafe fn line_u16_at(p: usize) -> u64 {
    let t = BRK as *const u64;
    let mut b = p >> 6;
    let mut m = *t.add(b) & below(p & 63);
    loop {
        if m != 0 {
            let q = b * 64 + 63 - m.leading_zeros() as usize;
            return U16_0 + u16_at(q + 1) as u64;
        }
        if b == 0 {
            return LINE_U16;
        }
        b -= 1;
        m = *t.add(b);
    }
}

// ── Stage 2 ──────────────────────────────────────────────────────────────

#[inline(always)]
fn digit(c: u8) -> bool {
    c.wrapping_sub(b'0') < 10
}

#[inline(always)]
unsafe fn byte(p: usize) -> u8 {
    *((WIN + p) as *const u8)
}

#[inline(always)]
unsafe fn digits(mut i: usize) -> usize {
    while digit(byte(i)) {
        i += 1;
    }
    i
}

/// The end of the number or literal at window offset `p` (0: not strict JSON).
#[inline(always)]
unsafe fn scalar(p: usize) -> usize {
    let c = byte(p);
    let mut i = p;
    if c == b'-' {
        i += 1;
    }
    let d = byte(i);
    if d == b'0' {
        i += 1;
    } else if d.wrapping_sub(b'1') < 9 {
        i = digits(i + 1);
    } else {
        if c == b't' && byte(p + 1) == b'r' && byte(p + 2) == b'u' && byte(p + 3) == b'e' {
            return p + 4;
        }
        if c == b'f' && byte(p + 1) == b'a' && byte(p + 2) == b'l' && byte(p + 3) == b's' && byte(p + 4) == b'e' {
            return p + 5;
        }
        if c == b'n' && byte(p + 1) == b'u' && byte(p + 2) == b'l' && byte(p + 3) == b'l' {
            return p + 4;
        }
        return 0;
    }
    if byte(i) == b'.' {
        if !digit(byte(i + 1)) {
            return 0;
        }
        i = digits(i + 2);
    }
    if byte(i) | 0x20 == b'e' {
        i += 1;
        if byte(i) == b'+' || byte(i) == b'-' {
            i += 1;
        }
        if !digit(byte(i)) {
            return 0;
        }
        i = digits(i + 1);
    }
    i
}

/// A top-level value that starts inside the token before it (`1true`: see dfa_splits) where a run stopped: its
/// window offset (the token index doesn't have it), or usize::MAX.
static mut SPLIT: usize = usize::MAX;
/// Whether the number or literal a window cut has had a whole value at its start yet (`0` of `0123`): one that
/// never has isn't a value (as scalar() == 0 in a window).
static mut PEVER: bool = false;

/// Where a number or literal at window offset `p` that isn't one goes wrong: its first byte that can't follow, or
/// the byte after it if it stops short, as a token cut by a window edge fails (so where a parse fails doesn't
/// depend on where windows are).
#[cold]
#[inline(never)]
unsafe fn bad_byte(p: usize, wlen: usize) -> usize {
    let mut s = D_START;
    let mut k = p;
    while k < wlen && !ENDS[byte(k) as usize] {
        s = dfa(s, byte(k));
        if s == D_BAD {
            return k;
        }
        k += 1;
    }
    k
}

// A number or literal cut by the window, a byte at a time: its state (D_*), or D_BAD.
const D_START: u32 = 0;
const D_MINUS: u32 = 1;
const D_ZERO: u32 = 2;
const D_INT: u32 = 3;
const D_DOT: u32 = 4;
const D_FRAC: u32 = 5;
const D_E: u32 = 6;
const D_ESIGN: u32 = 7;
const D_EXP: u32 = 8;
/** 16 + k: the first k bytes of a literal (LIT[k / 8 - 2]) matched. */
const D_LIT: u32 = 16;
const D_BAD: u32 = 255;
const LITS: [&[u8]; 3] = [b"true", b"false", b"null"];

fn dfa(s: u32, c: u8) -> u32 {
    match s {
        D_START => match c {
            b'-' => D_MINUS,
            b'0' => D_ZERO,
            b'1'..=b'9' => D_INT,
            b't' => D_LIT + 1,
            b'f' => D_LIT + 8 + 1,
            b'n' => D_LIT + 16 + 1,
            _ => D_BAD,
        },
        D_MINUS => match c {
            b'0' => D_ZERO,
            b'1'..=b'9' => D_INT,
            _ => D_BAD,
        },
        D_ZERO => match c {
            b'.' => D_DOT,
            b'e' | b'E' => D_E,
            _ => D_BAD,
        },
        D_INT => match c {
            b'0'..=b'9' => D_INT,
            b'.' => D_DOT,
            b'e' | b'E' => D_E,
            _ => D_BAD,
        },
        D_DOT | D_FRAC => match c {
            b'0'..=b'9' => D_FRAC,
            b'e' | b'E' if s == D_FRAC => D_E,
            _ => D_BAD,
        },
        D_E => match c {
            b'+' | b'-' => D_ESIGN,
            b'0'..=b'9' => D_EXP,
            _ => D_BAD,
        },
        D_ESIGN | D_EXP => match c {
            b'0'..=b'9' => D_EXP,
            _ => D_BAD,
        },
        _ if s >= D_LIT && s < D_LIT + 24 => {
            let k = (s - D_LIT) as usize;
            let (lit, at) = (LITS[k / 8], k % 8);
            if at < lit.len() && lit[at] == c {
                s + 1
            } else {
                D_BAD
            }
        }
        _ => D_BAD,
    }
}

/// Whether a top-level value can start at byte `c`, right after a number or literal that ended as `s` (a DFA
/// state) without a separator: tape-parser.ts reads `1true` and `1-2` as two values, `0123`, `0x1`, `1.5.2` and
/// `truex` as one (loose).
fn dfa_splits(s: u32, c: u8) -> bool {
    if s >= D_LIT {
        return !(c.is_ascii_alphanumeric() || c == b'_' || c == b'$' || c >= 0x80);
    }
    if digit(c) || c == b'.' || c == b'e' || c == b'E' {
        return false;
    }
    !(s == D_ZERO && (c == b'x' || c == b'X'))
}

/// dfa_splits for the number or literal at window offsets [p, e), followed by byte `c`.
unsafe fn splits(p: usize, e: usize, c: u8) -> bool {
    let first = byte(p);
    if first == b't' || first == b'f' || first == b'n' {
        return dfa_splits(D_LIT, c);
    }
    let zero = (e - p == 1 && first == b'0') || (e - p == 2 && first == b'-' && byte(p + 1) == b'0');
    dfa_splits(if zero { D_ZERO } else { D_INT }, c)
}

/// Whether tape-parser.ts reads a value starting at byte `c` (its startsValue: a top-level one makes several).
fn starts_value(c: u8) -> bool {
    matches!(c, b'{' | b'[' | b'"' | b'\'' | b'`' | b'-' | b'+' | b'.' | b'0'..=b'9' | b'a'..=b'z' | b'A'..=b'Z' | b'_' | b'$') || c >= 0x80
}

fn dfa_done(s: u32) -> bool {
    matches!(s, D_ZERO | D_INT | D_FRAC | D_EXP) || (s >= D_LIT && s < D_LIT + 24 && ((s - D_LIT) as usize % 8) == LITS[(s - D_LIT) as usize / 8].len())
}

#[inline(always)]
unsafe fn frame(d: usize) -> *mut u64 {
    (STACK as *mut u64).add(d * FR)
}

/// Room for `depth` + 1 frames (false: out of memory).
#[cold]
#[inline(never)]
unsafe fn grow_stack(depth: usize) -> bool {
    let mut cap = SCAP * 2;
    while cap <= depth {
        cap *= 2;
    }
    let p = alloc(cap * FR * 8);
    if p == 0 {
        return false;
    }
    core::ptr::copy_nonoverlapping(STACK as *const u8, p as *mut u8, SCAP * FR * 8);
    STACK = p;
    SCAP = cap;
    true
}

/// A directory record: [start, end, kind, depth, children, nodes before, closing lines before, nodes before its
/// end, closing lines before its end, the start of its container (-1: the top level)].
#[cold]
#[inline(never)]
unsafe fn dir_out(start: u64, end: u64, kind: u64, depth: usize, count: u64, n0: u64, c0: u64, n1: u64, c1: u64) -> bool {
    if !DIR.reserve(DW) {
        return false;
    }
    let parent = if depth > 0 { *frame(depth - 1).add(2) as f64 } else { -1.0 };
    for v in [start as f64, end as f64, kind as f64, depth as f64, count as f64, n0 as f64, c0 as f64, n1 as f64, c1 as f64, parent] {
        DIR.put(v);
    }
    true
}

/// Writes the parse's state at window offset `p` (a token) to `out`: the header (see snap()) and the frames
/// from `low` - 1 (`low`: the lowest depth since the last checkpoint: frames below it haven't changed; the
/// innermost frame's children count must be in its frame).
unsafe fn state_out(out: &mut Out, p: usize, state: u64, depth: usize, low: usize) -> bool {
    let from = if low > 0 { (low - 1).min(depth) } else { 0 };
    if !out.reserve(HW + (depth - from) * FW) {
        return false;
    }
    let line = |l: u64| if l == NONE { -1.0 } else { l as f64 };
    for v in [(POS0 + p as u64) as f64, state as f64, depth as f64, low as f64, NODES as f64, CLOSERS as f64, lines_at(p) as f64, (U16_0 + u16_at(p) as u64) as f64, line_u16_at(p) as f64, TOPN as f64, DEEPEST as f64, LOK as u32 as f64, line(LSEP), line(TOP_LINE), line(LAST_TOP_LINE)] {
        out.put(v);
    }
    for d in from..depth {
        let f = frame(d);
        for k in 0..FW {
            let v = *f.add(k);
            out.put(if v == NONE { -1.0 } else { v as f64 });
        }
    }
    true
}

/// The current state as a snapshot (header + every frame) at snap_ptr(): its length in f64. Header: byte of the
/// next token, state, depth, (0: every frame follows), nodes, closing lines, line breaks, UTF-16 units, the UTF-16 offset of the line's
/// start, top-level values, deepest nesting since the last checkpoint, whether top-level values since then were on
/// lines of their own, the first separator between them since then (-1: none), the line where the last top-level
/// value started, the line where the one before it ended (-1: none). Frames: kind, children, start, key, nodes
/// before, closing lines before.
#[no_mangle]
pub unsafe extern "C" fn snap() -> usize {
    let p = if SPLIT != usize::MAX { SPLIT } else if II < NIDX { *(IDX as *const u32).add(II) as usize } else { WLEN };
    SNAP.len = 0;
    if !state_out(&mut SNAP, p, STATE, DEPTH, 0) {
        return 0;
    }
    SNAP.len
}
#[no_mangle]
pub unsafe extern "C" fn snap_ptr() -> usize {
    SNAP.p
}

/// Room for a snapshot of `depth` frames at snap_ptr() (JS writes one there, then calls restore()); 0 if out of memory.
#[no_mangle]
pub unsafe extern "C" fn snap_room(depth: usize) -> usize {
    SNAP.len = 0;
    if !SNAP.reserve(HW + depth * FW) || (depth >= SCAP && !grow_stack(depth)) {
        return 0;
    }
    SNAP.p
}

/// Starts again from the snapshot at snap_ptr() (a state at a token, outside any string): the next window is
/// the document from the snapshot's byte. The duplicate check starts over (it knows no earlier names); the facts
/// of the whole document so far (facts()) are the caller's to give.
#[no_mangle]
pub unsafe extern "C" fn restore() -> u32 {
    let s = SNAP.p as *const f64;
    let h = |k: usize| *s.add(k) as u64;
    let depth = h(2) as usize;
    if depth >= SCAP && !grow_stack(depth) {
        return 0;
    }
    POS0 = h(0);
    STATE = h(1);
    DEPTH = depth;
    NODES = h(4);
    CLOSERS = h(5);
    LINES0 = h(6);
    U16_0 = h(7);
    LINE_U16 = h(8);
    TOPN = h(9);
    // (The state's stretch's facts go on into the next checkpoint's: what they're used for (the deepest, all on
    // lines of their own, the first separator) takes them once whatever stretch holds them.)
    DEEPEST = h(10);
    DEEP_ALL = 0;
    LOK = *s.add(11) != 0.0;
    LSEP = if *s.add(12) < 0.0 { NONE } else { h(12) };
    TOP_LINE = h(13);
    LAST_TOP_LINE = if *s.add(14) < 0.0 { NONE } else { h(14) };
    DUP_SKIPPED = 0;
    for d in 0..depth {
        let f = frame(d);
        for k in 0..FW {
            let v = *s.add(HW + d * FW + k);
            *f.add(k) = if v < 0.0 { NONE } else { v as u64 };
        }
        SERIAL += 1;
        *f.add(6) = SERIAL;
        *f.add(7) = DSLEN as u64;
        *f.add(8) = NONE;
        *f.add(9) = 1;
    }
    LOW = depth;
    reset_stage1();
    II = 0;
    SPLIT = usize::MAX;
    NIDX = 0;
    WLEN = 0;
    W_UNITS = 0;
    W_BREAKS = 0;
    W_LAST_BRK = usize::MAX;
    FINAL = false;
    PART = P_NONE;
    WHY = 0;
    NEXT_CK = if FLAGS & F_CHECKPOINTS != 0 { POS0 + CK_EVERY } else { NONE };
    1
}

/// After restore(): the facts of the document before the snapshot's byte: whether its top-level values were on
/// lines of their own, its first separator between them, where its second top-level value starts (-1: none).
#[no_mangle]
pub unsafe extern "C" fn facts(lines_ok: u32, sep: f64, second: f64) {
    LINES_OK = lines_ok != 0;
    SEP = if sep < 0.0 { NONE } else { sep as u64 };
    SECOND = if second < 0.0 { NONE } else { second as u64 };
}

// ── The duplicate check ──────────────────────────────────────────────────

#[inline(always)]
fn mix64(mut h: u64) -> u64 {
    h ^= h >> 33;
    h = h.wrapping_mul(0xff51_afd7_ed55_8ccd);
    h ^= h >> 33;
    h = h.wrapping_mul(0xc4ce_b9fe_1a85_ec53);
    h ^ (h >> 33)
}

/// A hash of the `len` bytes at `p` (8 more are readable).
#[inline(always)]
unsafe fn hash(p: usize, len: usize) -> u64 {
    let mut h: u64 = 0x9e37_79b9_7f4a_7c15 ^ len as u64;
    let mut j = 0;
    while j + 8 <= len {
        h = (h.rotate_left(23) ^ ((p + j) as *const u64).read_unaligned()).wrapping_mul(0x9e37_79b9_7f4a_7c15);
        j += 8;
    }
    let rest = len - j;
    if rest > 0 {
        let w = ((p + j) as *const u64).read_unaligned() & (!0u64 >> (64 - rest * 8));
        h = (h.rotate_left(23) ^ w).wrapping_mul(0x9e37_79b9_7f4a_7c15);
    }
    mix64(h)
}

fn hexv(c: u8) -> u32 {
    match c {
        b'0'..=b'9' => (c - b'0') as u32,
        _ => ((c | 0x20) - b'a' + 10) as u32,
    }
}

unsafe fn put(at: &mut usize, b: u8) {
    *((SCRATCH + *at) as *mut u8) = b;
    *at += 1;
}

unsafe fn wtf8(at: &mut usize, cp: u32) {
    if cp < 0x80 {
        put(at, cp as u8);
    } else if cp < 0x800 {
        put(at, 0xC0 | (cp >> 6) as u8);
        put(at, 0x80 | (cp & 0x3F) as u8);
    } else if cp < 0x10000 {
        put(at, 0xE0 | (cp >> 12) as u8);
        put(at, 0x80 | ((cp >> 6) & 0x3F) as u8);
        put(at, 0x80 | (cp & 0x3F) as u8);
    } else {
        put(at, 0xF0 | (cp >> 18) as u8);
        put(at, 0x80 | ((cp >> 12) & 0x3F) as u8);
        put(at, 0x80 | ((cp >> 6) & 0x3F) as u8);
        put(at, 0x80 | (cp & 0x3F) as u8);
    }
}

/// The name's `len` bytes at `a` with escapes decoded, as WTF-8 at SCRATCH (equal names as JS strings are equal
/// bytes): its length, or usize::MAX if too long to check.
#[cold]
#[inline(never)]
unsafe fn unescape(a: usize, len: usize) -> usize {
    if len > ESC_CAP {
        return usize::MAX;
    }
    if len * 3 > SCRATCH_CAP {
        let cap = (len * 3).next_power_of_two();
        let p = alloc(cap + 16);
        if p == 0 {
            return usize::MAX;
        }
        SCRATCH = p;
        SCRATCH_CAP = cap;
    }
    let at_ = |i: usize| *((a + i) as *const u8) as u32;
    let mut at = 0usize;
    let mut high = 0u32;
    let mut i = 0;
    while i < len {
        let mut c = at_(i);
        i += 1;
        let esc = c == b'\\' as u32;
        if esc {
            let x = at_(i) as u8;
            i += 1;
            c = match x {
                b'b' => 8,
                b'f' => 12,
                b'n' => 10,
                b'r' => 13,
                b't' => 9,
                b'u' => {
                    let h = |k: usize| hexv(at_(i + k) as u8);
                    let v = (h(0) << 12) | (h(1) << 8) | (h(2) << 4) | h(3);
                    i += 4;
                    v
                }
                _ => x as u32,
            };
        }
        if high != 0 {
            if (0xDC00..0xE000).contains(&c) && esc {
                wtf8(&mut at, 0x10000 + ((high - 0xD800) << 10) + (c - 0xDC00));
                high = 0;
                continue;
            }
            wtf8(&mut at, high);
            high = 0;
        }
        if esc && (0xD800..0xDC00).contains(&c) {
            high = c;
        } else if esc {
            wtf8(&mut at, c);
        } else {
            put(&mut at, c as u8);
        }
    }
    if high != 0 {
        wtf8(&mut at, high);
    }
    at
}

/** An object's names are kept in its list in DSTACK, checked one by one, up to this many; then in the table. */
const SMALL: usize = 16;
/** In frame field 7 (the object's first entry in DSTACK): its names are in the table. */
const TABLED: u64 = 1 << 63;

#[cold]
#[inline(never)]
unsafe fn warn(pos: u64, first: u64) -> bool {
    if WARNS < MAX_WARN {
        if !WARN.reserve(2) {
            return false;
        }
        WARN.put(pos as f64);
        WARN.put(first as f64);
        WARNS += 1;
    }
    true
}

/// Puts (tag, pos) in the table (kept at most half full). False if out of memory.
unsafe fn table_put(tag: u64, pos: u64) -> bool {
    if (DLIVE + 1) * 2 > DMASK + 1 {
        let size = (DMASK + 1) * 2;
        let t2 = alloc(size * 16);
        if t2 == 0 {
            return false;
        }
        core::ptr::write_bytes(t2 as *mut u8, 0, size * 16);
        let old = DTAB as *const u64;
        let t2p = t2 as *mut u64;
        for s in 0..=DMASK {
            let t = *old.add(s * 2);
            if t != 0 {
                let mut j = t as usize & (size - 1);
                while *t2p.add(j * 2) != 0 {
                    j = (j + 1) & (size - 1);
                }
                *t2p.add(j * 2) = t;
                *t2p.add(j * 2 + 1) = *old.add(s * 2 + 1);
            }
        }
        DTAB = t2;
        DMASK = size - 1;
    }
    let tab = DTAB as *mut u64;
    let mut slot = tag as usize & DMASK;
    while *tab.add(slot * 2) != 0 {
        slot = (slot + 1) & DMASK;
    }
    *tab.add(slot * 2) = tag;
    *tab.add(slot * 2 + 1) = pos;
    DLIVE += 1;
    true
}

/// A kept sequence: `which` 0 the last duplicate-free object's at depth `d`, 1 the open object's.
#[inline(always)]
unsafe fn seq(d: usize, which: usize) -> usize {
    SEQ + (d * 2 + which) * SEQ_SLOT
}
#[inline(always)]
unsafe fn seq_n(s: usize) -> usize {
    *(s as *const u32) as usize
}
#[inline(always)]
unsafe fn seq_off(s: usize, i: usize) -> usize {
    *((s + 8 + i * 4) as *const u32) as usize
}
/// Appends a name (`len` bytes at `a`, its quote at byte `pos`); false if it doesn't fit.
unsafe fn seq_push(s: usize, a: usize, len: usize, pos: u64) -> bool {
    let n = seq_n(s);
    let used = if n == 0 { 0 } else { seq_off(s, n) };
    if n >= SEQ_NAMES || used + len > SEQ_BYTES {
        return false;
    }
    core::ptr::copy_nonoverlapping(a as *const u8, (s + SEQ_TEXT + used) as *mut u8, len);
    *((s + 8) as *mut u32) = 0;
    *((s + 8 + (n + 1) * 4) as *mut u32) = (used + len) as u32;
    *((s + SEQ_POS + n * 8) as *mut u64) = pos;
    *(s as *mut u32) = (n + 1) as u32;
    true
}
/// Whether name `i` of sequence `s` is the `len` bytes at `a`.
#[inline(always)]
unsafe fn seq_eq(s: usize, i: usize, a: usize, len: usize) -> bool {
    let o = seq_off(s, i);
    if seq_off(s, i + 1) - o != len {
        return false;
    }
    let b = s + SEQ_TEXT + o;
    (0..len).all(|k| *((a + k) as *const u8) == *((b + k) as *const u8))
}

/// Checks the name whose `len` bytes are at `a` (memory, 8 more readable) and whose quote is at byte `pos`
/// against its object's names (frame `f`), and remembers it; through the shortcut (SEQ_DEPTH) when its object's
/// names so far are the last duplicate-free object's at its depth. False if out of memory.
#[inline(never)]
unsafe fn dup(f: *mut u64, a: usize, len: usize, pos: u64) -> bool {
    let d = (f as usize - STACK) / (FR * 8);
    if d < SEQ_DEPTH {
        let cur = seq(d, 1);
        let m = *f.add(8);
        if m != NONE {
            let last = seq(d, 0);
            if (m as usize) < seq_n(last) && seq_eq(last, m as usize, a, len) {
                // (A name kept without escapes, so the same bytes are the same name: only its place is kept.)
                *f.add(8) = m + 1;
                *((cur + SEQ_POS + m as usize * 8) as *mut u64) = pos;
                return true;
            }
            // Not the same names: the ones passed so far (the last object's first m, at the places kept) are this
            // object's list, and are checked in now.
            *f.add(8) = NONE;
            let j = m as usize;
            if j > 0 {
                let bytes = seq_off(last, j);
                core::ptr::copy_nonoverlapping((last + 8) as *const u8, (cur + 8) as *mut u8, (j + 1) * 4);
                core::ptr::copy_nonoverlapping((last + SEQ_TEXT) as *const u8, (cur + SEQ_TEXT) as *mut u8, bytes);
            }
            *(cur as *mut u32) = j as u32;
            for i in 0..seq_n(cur) {
                let o = seq_off(cur, i);
                if !dup_check(f, cur + SEQ_TEXT + o, seq_off(cur, i + 1) - o, *((cur + SEQ_POS + i * 8) as *const u64)) {
                    return false;
                }
            }
        }
        if *f.add(9) == 0 {
            let mut esc = false;
            for k in 0..len {
                if *((a + k) as *const u8) == b'\\' {
                    esc = true;
                    break;
                }
            }
            if esc || !seq_push(cur, a, len, pos) {
                *f.add(9) = 1;
            }
        }
    }
    dup_check(f, a, len, pos)
}

/// Checks a name against its object's names (frame `f`) and remembers it: see dup().
#[inline(never)]
unsafe fn dup_check(f: *mut u64, a: usize, len: usize, pos: u64) -> bool {
    let mut p = a;
    let mut l = len;
    let mut k = 0;
    while k < len {
        if *((a + k) as *const u8) == b'\\' {
            break;
        }
        k += 1;
    }
    if k < len {
        l = unescape(a, len);
        if l == usize::MAX {
            DUP_SKIPPED += 1;
            return true;
        }
        p = SCRATCH;
    }
    let mut tag = mix64(hash(p, l) ^ (*f.add(6)).wrapping_mul(0x2545_f491_4f6c_dd1d));
    if tag == 0 {
        tag = 1;
    }
    let field = *f.add(7);
    let base = (field & !TABLED) as usize;
    let mine = DSLEN - base;
    let st = DSTACK as *mut u64;
    if field & TABLED == 0 {
        // A small object: its own names, one by one.
        for j in base..DSLEN {
            if *st.add(j * 2) == tag {
                // (Not duplicate-free: its names aren't the shortcut's.)
                *f.add(9) = 1;
                return warn(pos, *st.add(j * 2 + 1));
            }
        }
    } else {
        let tab = DTAB as *const u64;
        let mut slot = tag as usize & DMASK;
        loop {
            let t = *tab.add(slot * 2);
            if t == 0 {
                break;
            }
            if t == tag {
                *f.add(9) = 1;
                return warn(pos, *tab.add(slot * 2 + 1));
            }
            slot = (slot + 1) & DMASK;
        }
    }
    // A new name: remembered if its object and all open objects have room.
    if mine as u64 >= DUP_CAP || DSLEN >= DUP_ALL {
        DUP_SKIPPED += 1;
        return true;
    }
    if DSLEN == DSCAP {
        let p2 = alloc(DSCAP * 32);
        if p2 == 0 {
            return false;
        }
        core::ptr::copy_nonoverlapping(DSTACK as *const u8, p2 as *mut u8, DSCAP * 16);
        DSTACK = p2;
        DSCAP *= 2;
    }
    let st = DSTACK as *mut u64;
    *st.add(DSLEN * 2) = tag;
    *st.add(DSLEN * 2 + 1) = pos;
    DSLEN += 1;
    if field & TABLED != 0 {
        return table_put(tag, pos);
    }
    if mine + 1 == SMALL {
        // Big enough for the table: its names go there.
        for j in base..DSLEN {
            if !table_put(*st.add(j * 2), *st.add(j * 2 + 1)) {
                return false;
            }
        }
        *f.add(7) = field | TABLED;
    }
    true
}

/// Forgets the names of the object closing (frame `f`); its names, duplicate-free and not the last object's at
/// its depth, are the shortcut's for the next.
#[inline(never)]
unsafe fn dup_pop(f: *mut u64) {
    let d = (f as usize - STACK) / (FR * 8);
    if d < SEQ_DEPTH && *f.add(9) == 0 && *f.add(8) == NONE {
        core::ptr::copy_nonoverlapping(seq(d, 1) as *const u8, seq(d, 0) as *mut u8, SEQ_SLOT);
    }
    let field = *f.add(7);
    let from = (field & !TABLED) as usize;
    if field & TABLED == 0 {
        DSLEN = from;
        return;
    }
    let tab = DTAB as *mut u64;
    while DSLEN > from {
        DSLEN -= 1;
        let tag = *(DSTACK as *const u64).add(DSLEN * 2);
        let mut slot = tag as usize & DMASK;
        while *tab.add(slot * 2) != tag {
            slot = (slot + 1) & DMASK;
        }
        // Backward-shift deletion (linear probing).
        let mut hole = slot;
        let mut j = slot;
        loop {
            j = (j + 1) & DMASK;
            let t = *tab.add(j * 2);
            if t == 0 {
                break;
            }
            let home = t as usize & DMASK;
            // Whether `home` is cyclically in (hole, j]: then it stays.
            let stays = if hole <= j { hole < home && home <= j } else { hole < home || home <= j };
            if !stays {
                *tab.add(hole * 2) = t;
                *tab.add(hole * 2 + 1) = *tab.add(j * 2 + 1);
                hole = j;
            }
        }
        *tab.add(hole * 2) = 0;
        DLIVE -= 1;
    }
}

/// The duplicate check of a name the window cut: its bytes so far are in CARRY (CARRY_LEN; usize::MAX: too long).
#[cold]
#[inline(never)]
unsafe fn carry_name(from: usize, to: usize) {
    if CARRY_LEN == usize::MAX {
        return;
    }
    let len = to - from;
    if CARRY_LEN + len > CARRY_CAP {
        CARRY_LEN = usize::MAX;
        return;
    }
    core::ptr::copy_nonoverlapping((WIN + from) as *const u8, (CARRY + CARRY_LEN) as *mut u8, len);
    CARRY_LEN += len;
}

// ── Stage 2 ──────────────────────────────────────────────────────────────

/// Walks the window's tokens from where it stopped: DONE (the document is complete), NEED (load the next
/// window: the bytes from next_pos()), STOP (at the target: see target(), why(), snap()) or FAIL (see why(),
/// fail_pos()). Checkpoints, directory records and warnings go to their buffers.
#[no_mangle]
pub unsafe extern "C" fn run() -> i32 {
    let idx = IDX as *const u32;
    let n = NIDX;
    let wlen = WLEN;
    let last = FINAL;
    let pos0 = POS0;
    let fail_at = FAIL_AT;
    let flags = FLAGS;
    let dups = flags & F_DUPS != 0;
    let dir = flags & F_DIR != 0;
    let big = BIG;
    let max_depth = MAX_DEPTH as usize;
    let local = |g: u64| if g <= pos0 { 0 } else if g - pos0 >= usize::MAX as u64 { usize::MAX } else { (g - pos0) as usize };
    let t_depth = T_DEPTH;
    let t_start = T_START;
    let t_count = T_COUNT;
    let t_at = local(T_BYTE);
    let t_val = T_VAL;
    let stop_at = local(T_AFTER);
    // (Where the next checkpoint is due or the pass stops: one compare on the hot path for both.)
    let ck_on = NEXT_CK != NONE;
    let mut ck_at = local(NEXT_CK).min(stop_at);
    let mut ii = II;
    let mut state = STATE;
    let mut depth = DEPTH;
    let mut low = LOW;
    let mut nodes = NODES;
    let mut closers = CLOSERS;
    let mut deepest = DEEPEST;
    let mut part = PART;
    // The innermost container (or the top level): its kind and children so far, in locals.
    let mut top = if depth > 0 { frame(depth - 1) } else { core::ptr::null_mut() };
    let (mut tkind, mut tcount) = if depth > 0 { (*top, *top.add(1)) } else { (0, TOPN) };
    macro_rules! fail {
        ($why:expr, $p:expr) => {{
            WHY = $why;
            failed_at($p as usize);
            break FAIL;
        }};
    }
    // A number or literal from byte $start that isn't one: not a value after all. (Still the second top-level
    // value's start if it was: whether the normal path takes a bare word as one is its repair's call.)
    macro_rules! unvalue {
        ($start:expr) => {{
            let _ = $start;
            nodes -= 1;
            tcount -= 1;
        }};
    }
    // What comes after a value: mostly a comma, taken here (unless a checkpoint is due there).
    macro_rules! after {
        () => {{
            if depth == 0 {
                state = S_TOP;
            } else {
                state = S_AFTER;
                if ii < n {
                    let q = *idx.add(ii) as usize;
                    if q < ck_at && q < fail_at && byte(q) == b',' {
                        ii += 1;
                        state = if tkind == OBJ { S_KEY } else { S_VALUE };
                    }
                }
            }
        }};
    }
    // A top-level value ends at window offset $e (its last byte): JSON Lines want it on lines of its own.
    macro_rules! top_end {
        ($e:expr) => {{
            if depth == 0 {
                let l = lines_at($e);
                if l != TOP_LINE {
                    LINES_OK = false;
                    LOK = false;
                }
                LAST_TOP_LINE = l;
            }
        }};
    }
    // A top-level value starts at window offset $p (JSON Lines want it on a line of its own).
    macro_rules! top_start {
        ($p:expr) => {{
            if tcount == 1 && SECOND == NONE && starts_value(byte($p)) {
                SECOND = pos0 + $p as u64;
            }
            let l = lines_at($p);
            if l == LAST_TOP_LINE {
                LINES_OK = false;
                LOK = false;
            }
            TOP_LINE = l;
        }};
    }
    // A string value from byte $start to window offset $q (its closing quote).
    macro_rules! string {
        ($start:expr, $q:expr) => {{
            let end = pos0 + $q as u64 + 1;
            if end - $start >= big {
                if dir && !dir_out($start, end, STR, depth, 0, nodes - 1, closers, nodes, closers) {
                    fail!(W_MEMORY, $q);
                }
                // A checkpoint right after a big value: a seek past it starts there.
                if ck_on {
                    ck_at = 0;
                    // (Kept past a stop there: the run that goes on still owes it.)
                    NEXT_CK = 0;
                }
            }
            top_end!($q);
            after!();
        }};
    }
    // The innermost container closes at window offset $p.
    macro_rules! close {
        ($p:expr) => {{
            let f = top;
            let start = *f.add(2);
            let end = pos0 + $p as u64 + 1;
            if end - start >= big {
                if dir && !dir_out(start, end, tkind, depth - 1, tcount, *f.add(4), *f.add(5), nodes, closers) {
                    fail!(W_MEMORY, $p);
                }
                if ck_on {
                    ck_at = 0;
                    // (Kept past a stop there: the run that goes on still owes it.)
                    NEXT_CK = 0;
                }
            }
            if tcount != 0 {
                closers += 1;
                if depth as u64 > deepest {
                    deepest = depth as u64;
                }
            }
            if dups && tkind == OBJ {
                dup_pop(f);
            }
            depth -= 1;
            if depth < low {
                low = depth;
            }
            if depth > 0 {
                top = frame(depth - 1);
                tkind = *top;
                tcount = *top.add(1);
            } else {
                top = core::ptr::null_mut();
                tkind = 0;
                tcount = TOPN;
            }
            top_end!($p);
            after!();
        }};
    }
    // Whether the innermost container is the target (its depth checked first).
    macro_rules! at_target {
        () => {
            depth == t_depth && (depth == 0 || *top.add(2) == t_start)
        };
    }
    // The innermost container's children count, into its frame.
    macro_rules! sync {
        () => {{
            if depth > 0 {
                *top.add(1) = tcount;
            } else {
                TOPN = tcount;
            }
        }};
    }
    // A checkpoint at window offset $p (before the token there).
    macro_rules! checkpoint {
        ($p:expr) => {{
            sync!();
            NODES = nodes;
            CLOSERS = closers;
            DEEPEST = deepest;
            if !state_out(&mut CK, $p, state, depth, low) {
                fail!(W_MEMORY, $p);
            }
            // (What follows is the next checkpoint's.)
            DEEP_ALL = DEEP_ALL.max(deepest);
            deepest = 0;
            LOK = true;
            LSEP = NONE;
            low = depth;
            NEXT_CK = pos0 + $p as u64 + CK_EVERY;
            ck_at = local(NEXT_CK).min(stop_at);
        }};
    }
    // Feeds window bytes [$from, $to) to DFA state $s (a number or literal the window cut); at the top level a
    // value may end and another start inside it (see dfa_splits). Fails at a byte that can't follow.
    macro_rules! feed {
        ($s:ident, $from:expr, $to:expr) => {{
            let mut k = $from;
            let mut bad = usize::MAX;
            while k < $to {
                let c = byte(k);
                let t = dfa($s, c);
                if t == D_BAD && depth == 0 && dfa_done($s) && dfa_splits($s, c) {
                    if k > 0 {
                        top_end!(k - 1);
                    }
                    top_start!(k);
                    nodes += 1;
                    tcount += 1;
                    PSTART = pos0 + k as u64;
                    PEVER = false;
                    $s = dfa(D_START, c);
                } else {
                    $s = t;
                }
                if $s != D_BAD && dfa_done($s) {
                    PEVER = true;
                }
                if $s == D_BAD {
                    bad = k;
                    break;
                }
                k += 1;
            }
            if bad != usize::MAX {
                // (What's read stops before it; with no whole value at its start, it isn't one: as in a window.)
                if !PEVER {
                    unvalue!(PSTART);
                }
                part = P_SCALAR;
                fail!(W_SYNTAX, bad);
            }
        }};
    }
    // A top-level value right after a number or literal (see dfa_splits), in the same token: where it starts.
    // (A stop there: the run that goes on starts at it.)
    let mut split = SPLIT;
    SPLIT = usize::MAX;
    let mut at_split = usize::MAX;
    let r = loop {
        // A token the last window cut.
        if part != P_NONE {
            if part == P_SCALAR {
                let mut j = 0;
                let mut s = PDFA;
                while j < wlen && !ENDS[byte(j) as usize] {
                    j += 1;
                }
                feed!(s, 0, j);
                if j == wlen && !last {
                    PDFA = s;
                    break NEED;
                }
                if !dfa_done(s) {
                    if !PEVER {
                        unvalue!(PSTART);
                    }
                    fail!(W_SYNTAX, j);
                }
                part = P_NONE;
                if j > 0 {
                    top_end!(j - 1);
                }
                after!();
                continue;
            }
            if ii >= n {
                if fail_at != usize::MAX {
                    fail!(W_SYNTAX, fail_at);
                }
                if last {
                    fail!(W_END, wlen);
                }
                if part == P_KEY && dups {
                    carry_name(0, wlen);
                }
                break NEED;
            }
            let q = *idx.add(ii) as usize;
            if q >= fail_at {
                fail!(W_SYNTAX, fail_at);
            }
            ii += 1;
            if part == P_STR {
                part = P_NONE;
                let start = PSTART;
                string!(start, q);
            } else {
                part = P_NONE;
                if dups {
                    carry_name(0, q);
                    if CARRY_LEN == usize::MAX {
                        DUP_SKIPPED += 1;
                    } else if !dup(top, CARRY, CARRY_LEN, PSTART) {
                        fail!(W_MEMORY, q);
                    }
                }
                state = S_COLON;
            }
            continue;
        }
        if split == usize::MAX && ii >= n {
            if fail_at != usize::MAX {
                fail!(W_SYNTAX, fail_at);
            }
            if last {
                if state == S_TOP {
                    // (A separator after the only top-level value is one too many: "Unexpected ','".)
                    if SEP != NONE && tcount == 1 && flags & F_LINES == 0 {
                        WHY = W_SYNTAX;
                        failed_at(wlen);
                        FAIL_POS = SEP;
                        break FAIL;
                    }
                    break DONE;
                }
                fail!(W_END, wlen);
            }
            break NEED;
        }
        let mut p = if split != usize::MAX { split } else { *idx.add(ii) as usize };
        at_split = split;
        split = usize::MAX;
        if p >= fail_at {
            fail!(W_SYNTAX, fail_at);
        }
        let mut c = byte(p);
        match state {
            S_AFTER => {
                if p >= ck_at {
                    if p >= stop_at {
                        WHY = W_AFTER;
                        break STOP;
                    }
                    checkpoint!(p);
                }
                if c == b',' {
                    ii += 1;
                    state = if tkind == OBJ { S_KEY } else { S_VALUE };
                    continue;
                }
                if c == (if tkind == OBJ { b'}' } else { b']' }) {
                    if at_target!() {
                        WHY = W_CLOSE;
                        break STOP;
                    }
                    ii += 1;
                    close!(p);
                    continue;
                }
                fail!(W_SYNTAX, p);
            }
            S_KEY | S_OBJ_FIRST => {
                if c == b'}' && state == S_OBJ_FIRST {
                    if at_target!() {
                        WHY = W_CLOSE;
                        break STOP;
                    }
                    ii += 1;
                    close!(p);
                    continue;
                }
                if c != b'"' {
                    fail!(W_SYNTAX, p);
                }
                if at_target!() && (tcount >= t_count || p >= t_at) {
                    WHY = W_CHILD;
                    break STOP;
                }
                let kpos = pos0 + p as u64;
                *top.add(3) = kpos;
                if ii + 1 >= n {
                    // The name goes on in the next window.
                    part = P_KEY;
                    PSTART = kpos;
                    if last {
                        // (What stage 1 found wrong in it first, as when a window cuts it.)
                        if fail_at != usize::MAX {
                            fail!(W_SYNTAX, fail_at);
                        }
                        fail!(W_END, wlen);
                    }
                    if dups {
                        CARRY_LEN = 0;
                        carry_name(p + 1, wlen);
                    }
                    ii += 1;
                    break NEED;
                }
                let q = *idx.add(ii + 1) as usize;
                if q >= fail_at {
                    // (Its name is where it breaks: being read there, as when a window cuts it.)
                    part = P_KEY;
                    PSTART = kpos;
                    fail!(W_SYNTAX, fail_at);
                }
                if dups {
                    // (The shortcut's common case in line: the last object's next name at this depth.)
                    let d = depth - 1;
                    let m = if d < SEQ_DEPTH { *top.add(8) } else { NONE };
                    if m != NONE && (m as usize) < seq_n(seq(d, 0)) && seq_eq(seq(d, 0), m as usize, WIN + p + 1, q - p - 1) {
                        *top.add(8) = m + 1;
                        *((seq(d, 1) + SEQ_POS + m as usize * 8) as *mut u64) = kpos;
                    } else if !dup(top, WIN + p + 1, q - p - 1, kpos) {
                        fail!(W_MEMORY, p);
                    }
                }
                ii += 2;
                // The colon, and the value in this same pass if it's in the window.
                if ii + 1 < n && byte(*idx.add(ii) as usize) == b':' {
                    ii += 1;
                    state = S_VALUE;
                    p = *idx.add(ii) as usize;
                    if p >= fail_at {
                        fail!(W_SYNTAX, fail_at);
                    }
                    c = byte(p);
                } else {
                    if ii < n && byte(*idx.add(ii) as usize) == b':' {
                        ii += 1;
                        state = S_VALUE;
                    } else {
                        state = S_COLON;
                    }
                    continue;
                }
            }
            S_COLON => {
                if c != b':' {
                    fail!(W_SYNTAX, p);
                }
                ii += 1;
                state = S_VALUE;
                continue;
            }
            S_TOP => {
                if p >= ck_at {
                    if p >= stop_at {
                        WHY = W_AFTER;
                        break STOP;
                    }
                    checkpoint!(p);
                }
                if c == b',' || c == b';' {
                    // Separators between top-level values (as tape-parser.ts takes JSON Lines): not JSON Lines.
                    if SEP == NONE {
                        SEP = pos0 + p as u64;
                    }
                    if LSEP == NONE {
                        LSEP = pos0 + p as u64;
                    }
                    LINES_OK = false;
                    LOK = false;
                    let mut j = p;
                    while byte(j) == b';' {
                        j += 1;
                    }
                    if c == b',' || ENDS[byte(j) as usize] {
                        ii += 1;
                        continue;
                    }
                    // A value right after a `;` (one token with it).
                    p = j;
                    c = byte(p);
                }
            }
            _ => {}
        }
        // A value (S_VALUE, S_ARR_FIRST, S_TOP), or the end of an empty array.
        if c == b']' && state == S_ARR_FIRST {
            if at_target!() {
                WHY = W_CLOSE;
                break STOP;
            }
            ii += 1;
            close!(p);
            continue;
        }
        if at_target!() && ((tkind != OBJ && (tcount >= t_count || p >= t_at)) || pos0 + p as u64 == t_val) {
            WHY = W_CHILD;
            break STOP;
        }
        if depth > max_depth {
            fail!(W_DEPTH, p);
        }
        if depth == 0 {
            top_start!(p);
        }
        nodes += 1;
        tcount += 1;
        match c {
            b'"' => {
                if ii + 1 >= n {
                    part = P_STR;
                    PSTART = pos0 + p as u64;
                    if last {
                        // (What stage 1 found wrong in it first, as when a window cuts it.)
                        if fail_at != usize::MAX {
                            fail!(W_SYNTAX, fail_at);
                        }
                        fail!(W_END, wlen);
                    }
                    ii += 1;
                    break NEED;
                }
                let q = *idx.add(ii + 1) as usize;
                if q >= fail_at {
                    // (The string is where it breaks: being read there, as when a window cuts it.)
                    part = P_STR;
                    PSTART = pos0 + p as u64;
                    fail!(W_SYNTAX, fail_at);
                }
                ii += 2;
                string!(pos0 + p as u64, q);
            }
            b'{' | b'[' => {
                sync!();
                if depth + 1 >= SCAP && !grow_stack(depth + 1) {
                    fail!(W_MEMORY, p);
                }
                let kind = if c == b'{' { OBJ } else { ARR };
                let f = frame(depth);
                *f = kind;
                *f.add(1) = 0;
                *f.add(2) = pos0 + p as u64;
                *f.add(3) = NONE;
                *f.add(4) = nodes - 1;
                *f.add(5) = closers;
                if dups && kind == OBJ {
                    SERIAL += 1;
                    *f.add(6) = SERIAL;
                    *f.add(7) = DSLEN as u64;
                    if depth < SEQ_DEPTH {
                        *(seq(depth, 1) as *mut u32) = 0;
                        *f.add(8) = if seq_n(seq(depth, 0)) > 0 { 0 } else { NONE };
                        *f.add(9) = 0;
                    } else {
                        *f.add(8) = NONE;
                        *f.add(9) = 1;
                    }
                }
                depth += 1;
                top = f;
                tkind = kind;
                tcount = 0;
                ii += 1;
                state = if kind == OBJ { S_OBJ_FIRST } else { S_ARR_FIRST };
            }
            _ => {
                // The window's last token may go on in the next one.
                if ii + 1 == n && !last {
                    let mut j = p;
                    while j < wlen && !ENDS[byte(j) as usize] {
                        j += 1;
                    }
                    if j == wlen {
                        let mut s = D_START;
                        PSTART = pos0 + p as u64;
                        PEVER = false;
                        feed!(s, p, wlen);
                        part = P_SCALAR;
                        PDFA = s;
                        ii += 1;
                        break NEED;
                    }
                }
                let e = scalar(p);
                if e == 0 {
                    // (Not a value: not counted as one; what's read stops before it, as when a window cuts it.)
                    unvalue!(pos0 + p as u64);
                    part = P_SCALAR;
                    PSTART = pos0 + p as u64;
                    fail!(W_SYNTAX, bad_byte(p, wlen));
                }
                let c2 = byte(e);
                if !ENDS[c2 as usize] {
                    if depth != 0 || !splits(p, e, c2) {
                        // (A value at its start (e > 0): counted, as one a window cuts.)
                        part = P_SCALAR;
                        PSTART = pos0 + p as u64;
                        fail!(W_SYNTAX, bad_byte(p, wlen));
                    }
                    // Another top-level value right after it, in the same token.
                    top_end!(e - 1);
                    after!();
                    split = e;
                    continue;
                }
                ii += 1;
                top_end!(e - 1);
                after!();
            }
        }
    };
    // (Stopped at a top-level value that starts in the token before: where it is, and where to go on from.)
    if r == STOP {
        SPLIT = at_split;
    }
    // (A window that ends inside a token isn't done until what stage 1 found wrong in it is reported.)
    let r = if r == NEED && fail_at != usize::MAX {
        WHY = W_SYNTAX;
        failed_at(fail_at);
        FAIL
    } else {
        r
    };
    sync!();
    PART = part;
    if r == NEED {
        // The window is done: the next starts where it ends.
        if W_LAST_BRK != usize::MAX {
            LINE_U16 = U16_0 + u16_at(W_LAST_BRK + 1) as u64;
        }
        POS0 = pos0 + wlen as u64;
        U16_0 += W_UNITS;
        LINES0 += W_BREAKS;
        ii = 0;
        NIDX = 0;
        // (Counted once: a run on the empty window that's left, or a snapshot now, adds nothing more.)
        WLEN = 0;
        W_UNITS = 0;
        W_BREAKS = 0;
        W_LAST_BRK = usize::MAX;
    }
    II = ii;
    STATE = state;
    DEPTH = depth;
    LOW = low;
    NODES = nodes;
    CLOSERS = closers;
    DEEPEST = deepest;
    r
}
