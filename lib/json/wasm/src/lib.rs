//! Strict JSON into a tape (see ../../tape.ts) with WebAssembly SIMD: what the JS tape parser
//! (../../tape-parser.ts) gives for a document that is strict JSON, faster, from UTF-8 bytes.
//!
//! Input comes in windows (JS copies or encodes the text a window at a time, so the document is never
//! copied whole). Each window starts where a token starts, outside any string; it is parsed in two
//! stages, as simdjson does: stage 1 classifies 64 bytes at a time with SIMD and lists where tokens
//! start (and keeps, per 64 bytes, what turns byte offsets into UTF-16 offsets); stage 2 walks that
//! list and writes the nodes. A token that the window cuts is parsed again from the next window.
//! Nodes go out in batches (JS copies them into the tape); a container that closes after its node
//! went out is patched by JS.
//!
//! Anything that isn't strict JSON (or a single top-level value) stops it: JS then parses the
//! document with the JS tape parser, which reports what it found. So this needs no error messages,
//! and only has to agree with the JS parser on strict documents (tests/tape-wasm.test.ts).
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

// The tape (tape.ts).
const W: usize = 5;
const NUL: u32 = 0;
const BOOL: u32 = 1;
const NUM: u32 = 2;
const STR: u32 = 3;
const ARR: u32 = 4;
const OBJ: u32 = 5;
const KEY_NONE: u32 = 0;
const KEY_INDEX: u32 = 1;
const KEY_NAME: u32 = 2;
const V_NULL: u32 = 0;
const V_TRUE: u32 = 1;
const V_FALSE: u32 = 2;
const V_NONE: u32 = 3;
const V_SLICE: u32 = 4;
const V_DECODE: u32 = 6;
const SIZE_BIG: u32 = 0xff_ffff;
/** Warnings kept, as the JS parser. */
const MAX_WARN: usize = 500;

// run() results.
const DONE: i32 = 0;
const NEED: i32 = 1;
const FULL: i32 = 2;
const FAIL: i32 = -1;

// What stage 2 expects next.
const S_VALUE: u32 = 0;
const S_ARR_FIRST: u32 = 1;
const S_OBJ_FIRST: u32 = 2;
const S_KEY: u32 = 3;
const S_COLON: u32 = 4;
const S_AFTER: u32 = 5;
const S_DONE: u32 = 6;

const ODD: u64 = 0xAAAA_AAAA_AAAA_AAAA;

/// Bytes that can follow a number or literal (anything else makes it something else): whitespace,
/// brackets, comma, colon, quote.
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
/** Nodes per batch. */
const OCAP: usize = 32768;
/** u32 per open container (STACK). */
const F: usize = 5;

// ── Memory: a bump allocator (one parse per instance) and growable arrays ─────

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

/// A growable array of u32 (a copy on growth: the old space stays unused).
#[derive(Clone, Copy)]
struct Buf {
    p: usize,
    len: usize,
    cap: usize,
}

impl Buf {
    const fn new() -> Buf {
        Buf { p: 0, len: 0, cap: 0 }
    }
    #[inline(always)]
    unsafe fn get(&self, i: usize) -> u32 {
        *(self.p as *const u32).add(i)
    }
    #[inline(always)]
    unsafe fn set(&self, i: usize, v: u32) {
        *(self.p as *mut u32).add(i) = v;
    }
    #[inline(always)]
    unsafe fn reserve(&mut self, extra: usize) -> bool {
        self.len + extra <= self.cap || self.grow(extra)
    }
    #[cold]
    #[inline(never)]
    unsafe fn grow(&mut self, extra: usize) -> bool {
        let mut cap = if self.cap < 64 { 64 } else { self.cap * 2 };
        while cap < self.len + extra {
            cap *= 2;
        }
        let p = alloc(cap * 4);
        if p == 0 {
            return false;
        }
        core::ptr::copy_nonoverlapping(self.p as *const u8, p as *mut u8, self.len * 4);
        self.p = p;
        self.cap = cap;
        true
    }
    #[inline(always)]
    unsafe fn push(&mut self, v: u32) -> bool {
        if self.len == self.cap && !self.reserve(1) {
            return false;
        }
        self.set(self.len, v);
        self.len += 1;
        true
    }
}

// ── State ────────────────────────────────────────────────────────────────

/** Input came from a JS string (encodeInto: a lone surrogate became U+FFFD), not from bytes (validated as UTF-8 here). */
static mut FROM_TEXT: bool = false;
/**
 * The window came as the string's UTF-16 units at WIDE_BUF (copied by JS), one byte per unit at WIN
 * (a unit above 0xFF as 0xFF): byte offsets are UTF-16 offsets, and names with units above 0x7F are
 * read from the units (unescape).
 */
static mut WIDE: bool = false;
static mut WIDE_BUF: usize = 0;
static mut WIDE_CAP: usize = 0;
static mut MAX_DEPTH: u32 = u32::MAX;

// The window: WLEN bytes at WIN (+ 64 bytes of spaces), from UTF-16 offset WU16 of the document.
static mut WIN: usize = 0;
static mut WCAP: usize = 0;
static mut WLEN: usize = 0;
static mut WU16: u32 = 0;
static mut FINAL: bool = false;
static mut ASCII: bool = true;
// Stage 1: token starts (window offsets), and per 64 bytes: UTF-16 units before them, the bytes that
// start a character, those that start a 4-byte one, backslashes, bytes >= 0x80.
static mut IDX: usize = 0;
static mut NIDX: usize = 0;
static mut BASE: usize = 0;
static mut NONC: usize = 0;
static mut FOUR: usize = 0;
static mut BSM: usize = 0;
static mut HIM: usize = 0;
// Stage 2.
static mut II: usize = 0;
static mut STATE: u32 = S_VALUE;
static mut RESUME: usize = 0;
static mut PENDING_KEY: u32 = 0;
static mut DEPTH_SEEN: u32 = 0;
static mut EXACT: bool = true;
/** Open containers: node, kind, children so far, undo log length when opened, the last member's key. */
static mut STACK: Buf = Buf::new();
// Output: a batch of nodes from node OBASE, containers to patch (node, size, end) and big sizes (node, size).
static mut OUT: usize = 0;
static mut OBASE: usize = 0;
static mut COUNT: usize = 0;
static mut PATCH: Buf = Buf::new();
static mut BIG: Buf = Buf::new();
/** Duplicate property names: (UTF-16 offset of the name, key). */
static mut WARN: Buf = Buf::new();
// Property names: an open-addressing table of key + 1 by hash, and per key: hash, its bytes (decoded:
// WTF-8) in ARENA, UTF-16 offsets of its first quote and after its closing quote, flags (1: written
// with escapes there, 2: integer-like), the open object that has it (node + 1, see dup()).
static mut KTAB: Buf = Buf::new();
static mut KHASH: Buf = Buf::new();
static mut KOFF: Buf = Buf::new();
static mut KLEN: Buf = Buf::new();
static mut KU16: Buf = Buf::new();
static mut KEND: Buf = Buf::new();
static mut KFLAG: Buf = Buf::new();
static mut MARK: Buf = Buf::new();
static mut ARENA: usize = 0;
static mut ALEN: usize = 0;
static mut ACAP: usize = 0;
/** (key, previous MARK) for each name an open object took: undone when it closes. */
static mut UNDO: Buf = Buf::new();
// Guesses of the next property name: per key, the name that followed it last time; per depth, the
// first name of the last object there.
static mut FOLLOWS: Buf = Buf::new();
static mut FIRSTS: Buf = Buf::new();
static mut SCRATCH: usize = 0;
static mut SCAP: usize = 0;

/// Starts a parse: `text` 1 if the input is a JS string's UTF-8, `max_depth` as TapeOptions.maxDepth,
/// `wcap` the window size in bytes. Returns 0 if out of memory.
#[no_mangle]
pub unsafe extern "C" fn init(text: u32, max_depth: u32, wcap: usize) -> u32 {
    TOP = &__heap_base as *const u8 as usize;
    FROM_TEXT = text != 0;
    MAX_DEPTH = max_depth;
    WU16 = 0;
    FINAL = false;
    II = 0;
    NIDX = 0;
    STATE = S_VALUE;
    DEPTH_SEEN = 0;
    EXACT = true;
    OBASE = 0;
    COUNT = 0;
    STACK = Buf::new();
    PATCH = Buf::new();
    BIG = Buf::new();
    WARN = Buf::new();
    KHASH = Buf::new();
    KOFF = Buf::new();
    KLEN = Buf::new();
    KU16 = Buf::new();
    KEND = Buf::new();
    KFLAG = Buf::new();
    MARK = Buf::new();
    UNDO = Buf::new();
    FOLLOWS = Buf::new();
    FIRSTS = Buf::new();
    KTAB = Buf::new();
    WIDE_CAP = 0;
    ALEN = 0;
    ACAP = 1 << 16;
    ARENA = alloc(ACAP);
    SCAP = 1 << 12;
    SCRATCH = alloc(SCAP);
    OUT = alloc(OCAP * W * 4);
    if ARENA == 0 || SCRATCH == 0 || OUT == 0 || !KTAB.reserve(1024) || !STACK.reserve(256) {
        return 0;
    }
    KTAB.len = 1024;
    core::ptr::write_bytes(KTAB.p as *mut u8, 0, 1024 * 4);
    window(wcap)
}

/// Makes the window `wcap` bytes. Returns 0 if out of memory.
#[no_mangle]
pub unsafe extern "C" fn window(wcap: usize) -> u32 {
    let blocks = wcap / 64 + 2;
    WIN = alloc(wcap + 128);
    IDX = alloc((wcap + 64 + 16) * 4);
    BASE = alloc(blocks * 4);
    NONC = alloc(blocks * 8);
    FOUR = alloc(blocks * 8);
    BSM = alloc(blocks * 8);
    HIM = alloc(blocks * 8);
    if WIN == 0 || IDX == 0 || BASE == 0 || NONC == 0 || FOUR == 0 || BSM == 0 || HIM == 0 {
        return 0;
    }
    WCAP = wcap;
    1
}

#[no_mangle]
pub unsafe extern "C" fn win_ptr() -> usize {
    WIN
}
/** Where JS copies a window's UTF-16 units (room for win_cap() of them); 0 if out of memory. */
#[no_mangle]
pub unsafe extern "C" fn wide_ptr() -> usize {
    if WIDE_CAP < WCAP {
        // (+ 32 units: the last 16 are read whole.)
        WIDE_BUF = alloc(WCAP * 2 + 64);
        WIDE_CAP = if WIDE_BUF == 0 { 0 } else { WCAP };
    }
    WIDE_BUF
}
#[no_mangle]
pub unsafe extern "C" fn win_cap() -> usize {
    WCAP
}
#[no_mangle]
pub unsafe extern "C" fn out_ptr() -> usize {
    OUT
}
/** Nodes in the batch. */
#[no_mangle]
pub unsafe extern "C" fn out_len() -> usize {
    COUNT - OBASE
}
/** The batch was copied: the next one starts. */
#[no_mangle]
pub unsafe extern "C" fn drain() {
    OBASE = COUNT;
}
#[no_mangle]
pub unsafe extern "C" fn count() -> usize {
    COUNT
}
#[no_mangle]
pub unsafe extern "C" fn depth() -> u32 {
    DEPTH_SEEN
}
#[no_mangle]
pub unsafe extern "C" fn exact() -> u32 {
    EXACT as u32
}
/** How far stage 2 is in the window (the next token's offset). */
#[no_mangle]
pub unsafe extern "C" fn pos() -> usize {
    if II < NIDX {
        *(IDX as *const u32).add(II) as usize
    } else {
        WLEN
    }
}
/** Where the next window starts: its offset in this window (0: a token is longer than the window, make it bigger), and in UTF-16. */
#[no_mangle]
pub unsafe extern "C" fn resume() -> usize {
    RESUME
}
#[no_mangle]
pub unsafe extern "C" fn resume_u16() -> u32 {
    u16_at(RESUME)
}
#[no_mangle]
pub unsafe extern "C" fn patch_ptr() -> usize {
    PATCH.p
}
#[no_mangle]
pub unsafe extern "C" fn patch_len() -> usize {
    PATCH.len
}
#[no_mangle]
pub unsafe extern "C" fn big_ptr() -> usize {
    BIG.p
}
#[no_mangle]
pub unsafe extern "C" fn big_len() -> usize {
    BIG.len
}
#[no_mangle]
pub unsafe extern "C" fn warn_ptr() -> usize {
    WARN.p
}
#[no_mangle]
pub unsafe extern "C" fn warn_len() -> usize {
    WARN.len
}
#[no_mangle]
pub unsafe extern "C" fn keys() -> usize {
    KHASH.len
}
#[no_mangle]
pub unsafe extern "C" fn key_u16_ptr() -> usize {
    KU16.p
}
#[no_mangle]
pub unsafe extern "C" fn key_end_ptr() -> usize {
    KEND.p
}
#[no_mangle]
pub unsafe extern "C" fn key_flag_ptr() -> usize {
    KFLAG.p
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

/// By low 4 bits: { } (| 0x20 also [ ]), : and , (control characters | 0x20 that land on : or , fail anyway).
const OPS: v128 = u8x16(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, b':', b'{', b',', b'}', 0, 0);
/// By low 4 bits: space, tab, line feed, carriage return.
const WS: v128 = u8x16(b' ', 0, 0, 0, 0, 0, 0, 0, 0, b'\t', b'\n', 0, 0, b'\r', 0, 0);

/// `f` (16 bits of mask per 16 bytes) over 64 bytes.
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

/// Takes the `len` bytes written at the window (the document from UTF-16 offset `u16_start`;
/// `last` 1 if they end it; `cr` 1 if the byte before them is a carriage return) and runs stage 1.
/// `wide` 1: `len` UTF-16 units were written at wide_ptr() instead. Returns FAIL if they aren't strict
/// JSON, else 0.
#[no_mangle]
pub unsafe extern "C" fn load(len: usize, last: u32, u16_start: u32, cr: u32, wide: u32) -> i32 {
    WLEN = len;
    FINAL = last != 0;
    WU16 = u16_start;
    II = 0;
    WIDE = wide != 0;
    let inp = WIN;
    if WIDE {
        // One byte per unit (no unit above 0xFF can be one that JSON's syntax uses).
        let (from, cap) = (WIDE_BUF, u16x8_splat(255));
        let mut k = 0;
        while k < len {
            let a = u16x8_min(v128_load((from + k * 2) as *const v128), cap);
            let b = u16x8_min(v128_load((from + k * 2 + 16) as *const v128), cap);
            v128_store((inp + k) as *mut v128, u8x16_narrow_i16x8(a, b));
            k += 16;
        }
    }
    core::ptr::write_bytes((inp + len) as *mut u8, b' ', 128);
    let idx = IDX as *mut u32;
    let base = BASE as *mut u32;
    let nonc_t = NONC as *mut u64;
    let four_t = FOUR as *mut u64;
    let bs_t = BSM as *mut u64;
    let hi_t = HIM as *mut u64;
    let blocks = len.div_ceil(64);
    let mut n = 0usize;
    let mut next_escaped: u64 = 0;
    let mut prev_in: u64 = 0;
    let mut prev_scalar: u64 = 0;
    let mut u_carry: u64 = 0;
    let mut units: u32 = 0;
    let mut hi_any: u64 = 0;
    // From bytes, a line feed after a carriage return is no UTF-16 unit: the text is the bytes with their
    // line ends as \n (doc.ts lf()), as the page keeps it; a lone \r stays one unit, as its \n.
    let crlf = !FROM_TEXT;
    let mut cr_carry: u64 = (crlf && cr != 0) as u64;
    let mut drop_any: u64 = 0;
    let mut fail_at = usize::MAX;
    for b in 0..blocks {
        let p = b * 64;
        let v0 = v128_load((inp + p) as *const v128);
        let v1 = v128_load((inp + p + 16) as *const v128);
        let v2 = v128_load((inp + p + 32) as *const v128);
        let v3 = v128_load((inp + p + 48) as *const v128);
        let vs = [v0, v1, v2, v3];
        // Masks of what is rare are made only when a quick test finds some.
        let or4 = |f: &dyn Fn(v128) -> v128| v128_any_true(v128_or(v128_or(f(v0), f(v1)), v128_or(f(v2), f(v3))));
        let q = m4(&vs, |v| eqm(v, b'"'));
        let bs = if or4(&|v| i8x16_eq(v, u8x16_splat(b'\\'))) { m4(&vs, |v| eqm(v, b'\\')) } else { 0 };
        let ctl = if or4(&|v| u8x16_lt(v, u8x16_splat(0x20))) { m4(&vs, |v| i8x16_bitmask(u8x16_lt(v, u8x16_splat(0x20))) as u64) } else { 0 };
        let hi = if or4(&|v| v) { m4(&vs, |v| i8x16_bitmask(v) as u64) } else { 0 };
        // A block inside a string, with no quote, backslash or control character: nothing to list.
        let inside = prev_in != 0 && q == 0 && bs == 0 && ctl == 0 && next_escaped == 0 && u_carry == 0;
        // Whitespace and brackets by table: the byte (| 0x20 for brackets) is the table's entry for its low 4 bits.
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
        let mut drop = 0u64;
        if crlf {
            // (Only where a \r is: a pair needs one here, or the last byte of the block before.)
            if ctl != 0 && (cr_carry != 0 || or4(&|v| i8x16_eq(v, u8x16_splat(b'\r')))) {
                let cr = m4(&vs, |v| eqm(v, b'\r'));
                drop = m4(&vs, |v| eqm(v, b'\n')) & ((cr << 1) | cr_carry);
                cr_carry = cr >> 63;
                drop_any |= drop;
            } else {
                cr_carry = 0;
            }
        }
        *base.add(b) = units;
        *bs_t.add(b) = bs;
        *hi_t.add(b) = hi;
        if hi != 0 && !WIDE {
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
            // Digits that spill into the next block.
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
        // (As simdjson: 8 at a time without a branch each; the extra writes are overwritten. IDX has room.)
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
    // (Failures in the padding, or in a token the window cuts, are the next window's.)
    if fail_at < len {
        return FAIL;
    }
    // Tokens that start in the padding.
    while n > 0 && *idx.add(n - 1) as usize >= len {
        n -= 1;
    }
    NIDX = n;
    // (The padding is spaces: any high bit is the window's.) One byte is one unit only without both.
    ASCII = hi_any == 0 && drop_any == 0;
    0
}

#[inline(always)]
unsafe fn byte(p: usize) -> u8 {
    *((WIN + p) as *const u8)
}

/// The UTF-16 offset of window offset `p` (0..=WLEN).
#[inline(always)]
unsafe fn u16_at(p: usize) -> u32 {
    if ASCII {
        return WU16 + p as u32;
    }
    let b = p >> 6;
    let m = below(p & 63);
    WU16 + *(BASE as *const u32).add(b) + (*(NONC as *const u64).add(b) & m).count_ones() + (*(FOUR as *const u64).add(b) & m).count_ones()
}

/// The window, in locals: what stage 2 reads all the time (statics are read again after every store).
#[derive(Clone, Copy)]
struct Win {
    p: usize,
    ascii: bool,
    u16: u32,
    base: usize,
    nonc: usize,
    four: usize,
}

impl Win {
    #[inline(always)]
    unsafe fn now() -> Win {
        Win { p: WIN, ascii: ASCII, u16: WU16, base: BASE, nonc: NONC, four: FOUR }
    }
    #[inline(always)]
    unsafe fn byte(&self, i: usize) -> u8 {
        *((self.p + i) as *const u8)
    }
    #[inline(always)]
    unsafe fn u16(&self, p: usize) -> u32 {
        if self.ascii {
            return self.u16 + p as u32;
        }
        let b = p >> 6;
        let m = below(p & 63);
        self.u16 + *(self.base as *const u32).add(b) + (*(self.nonc as *const u64).add(b) & m).count_ones() + (*(self.four as *const u64).add(b) & m).count_ones()
    }
}

/// Whether any bit of the per-block masks at `t` is set in window offsets [a, e).
#[inline(always)]
unsafe fn any(t: usize, a: usize, e: usize) -> bool {
    if a >= e {
        return false;
    }
    let t = t as *const u64;
    let (ba, be) = (a >> 6, (e - 1) >> 6);
    let lo = !below(a & 63);
    let hi = below(((e - 1) & 63) + 1);
    if ba == be {
        return *t.add(ba) & lo & hi != 0;
    }
    if *t.add(ba) & lo != 0 || *t.add(be) & hi != 0 {
        return true;
    }
    for b in ba + 1..be {
        if *t.add(b) != 0 {
            return true;
        }
    }
    false
}

/// Whether window bytes [a, e) are valid UTF-8 (no surrogates, no overlong forms).
#[cold]
#[inline(never)]
unsafe fn utf8(a: usize, e: usize) -> bool {
    let mut i = a;
    while i < e {
        let c = byte(i);
        if c < 0x80 {
            i += 1;
            continue;
        }
        let (n, min) = if c & 0xE0 == 0xC0 {
            (1, 0x80u32)
        } else if c & 0xF0 == 0xE0 {
            (2, 0x800)
        } else if c & 0xF8 == 0xF0 {
            (3, 0x10000)
        } else {
            return false;
        };
        if i + n >= e {
            return false;
        }
        let mut cp = (c as u32) & (0x3F >> n);
        for k in 1..=n {
            let d = byte(i + k);
            if d & 0xC0 != 0x80 {
                return false;
            }
            cp = (cp << 6) | (d as u32 & 0x3F);
        }
        if cp < min || cp > 0x10FFFF || (0xD800..=0xDFFF).contains(&cp) {
            return false;
        }
        i += n + 1;
    }
    true
}

// ── Stage 2 ──────────────────────────────────────────────────────────────

#[inline(always)]
fn digit(c: u8) -> bool {
    c.wrapping_sub(b'0') < 10
}

/// The end of the run of digits from window offset `i` (the window's padding ends any run).
#[inline(always)]
unsafe fn digits(w: &Win, mut i: usize) -> usize {
    while digit(w.byte(i)) {
        i += 1;
    }
    i
}

/// A number or literal at `p`: its kind and value kind, its end (0: not strict JSON), and for a
/// number whether it is canonical (parser.ts's isCanonical) if `check`.
#[inline(always)]
unsafe fn scalar(w: &Win, p: usize, check: bool) -> (u32, u32, usize, bool) {
    let c = w.byte(p);
    let mut i = p;
    if c == b'-' {
        i += 1;
    }
    let d = w.byte(i);
    if d == b'0' {
        i += 1;
    } else if d.wrapping_sub(b'1') < 9 {
        i = digits(w, i + 1);
    } else {
        if c == b't' && w.byte(p + 1) == b'r' && w.byte(p + 2) == b'u' && w.byte(p + 3) == b'e' {
            return (BOOL, V_TRUE, p + 4, true);
        }
        if c == b'f' && w.byte(p + 1) == b'a' && w.byte(p + 2) == b'l' && w.byte(p + 3) == b's' && w.byte(p + 4) == b'e' {
            return (BOOL, V_FALSE, p + 5, true);
        }
        if c == b'n' && w.byte(p + 1) == b'u' && w.byte(p + 2) == b'l' && w.byte(p + 3) == b'l' {
            return (NUL, V_NULL, p + 4, true);
        }
        return (NUM, V_SLICE, 0, true);
    }
    let mut dot = false;
    if w.byte(i) == b'.' {
        dot = true;
        if !digit(w.byte(i + 1)) {
            return (NUM, V_SLICE, 0, true);
        }
        i = digits(w, i + 2);
    }
    let mut exp = false;
    if w.byte(i) | 0x20 == b'e' {
        exp = true;
        i += 1;
        if w.byte(i) == b'+' || w.byte(i) == b'-' {
            i += 1;
        }
        if !digit(w.byte(i)) {
            return (NUM, V_SLICE, 0, true);
        }
        i = digits(w, i + 1);
    }
    (NUM, V_SLICE, i, !check || canonical(w, p, i, dot, exp))
}

/// parser.ts's isCanonical(raw): `String(Number(raw)) === raw`.
unsafe fn canonical(w: &Win, a: usize, e: usize, dot: bool, exp: bool) -> bool {
    let neg = w.byte(a) == b'-';
    let b = if neg { a + 1 } else { a };
    if e - b > 15 || (neg && e - a == 2 && w.byte(b) == b'0') || exp {
        return false;
    }
    if !dot {
        return true;
    }
    if w.byte(e - 1) == b'0' {
        return false;
    }
    if e - b >= 8 && w.byte(b) == b'0' && w.byte(b + 1) == b'.' {
        for k in b + 2..b + 8 {
            if w.byte(k) != b'0' {
                return true;
            }
        }
        return false;
    }
    true
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

/// Writes code point (or lone surrogate) `cp` as WTF-8 to the scratch buffer.
#[inline(never)]
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

/// The name at window offsets [a, e) (stage 1 checked its escapes), escapes decoded, as WTF-8 in the
/// scratch buffer: equal names as JS strings are equal bytes (a surrogate pair, escaped or not, is one
/// character). From UTF-8 its other bytes are copied; WIDE, its UTF-16 units are encoded. Returns the
/// length, or usize::MAX if out of memory.
#[inline(never)]
unsafe fn unescape(a: usize, e: usize) -> usize {
    if (e - a) * 3 > SCAP {
        SCAP = ((e - a) * 3).next_power_of_two();
        SCRATCH = alloc(SCAP);
        if SCRATCH == 0 {
            return usize::MAX;
        }
    }
    let wide = WIDE;
    let at_ = |i: usize| if wide { *((WIDE_BUF + i * 2) as *const u16) as u32 } else { byte(i) as u32 };
    let mut at = 0usize;
    // A high surrogate waiting for what follows.
    let mut high = 0u32;
    let mut i = a;
    while i < e {
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
            if (0xDC00..0xE000).contains(&c) {
                wtf8(&mut at, 0x10000 + ((high - 0xD800) << 10) + (c - 0xDC00));
                high = 0;
                continue;
            }
            wtf8(&mut at, high);
            high = 0;
        }
        if (0xD800..0xDC00).contains(&c) {
            high = c;
        } else if esc || wide {
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

#[inline(always)]
fn mix(mut h: u32) -> u32 {
    h ^= h >> 16;
    h = h.wrapping_mul(0x045d_9f3b);
    h ^ (h >> 16)
}

unsafe fn hash(p: *const u8, len: usize) -> u32 {
    let mut h: u32 = 0x811c_9dc5;
    for k in 0..len {
        h = (h ^ *p.add(k) as u32).wrapping_mul(0x0100_0193);
    }
    h
}

/// Whether the name `len` bytes at `p` is integer-like (parser.ts INT_KEY: 0, or 1-10 digits not starting with 0).
unsafe fn int_like(p: *const u8, len: usize) -> bool {
    if len == 0 || !digit(*p) {
        return false;
    }
    if len == 1 {
        return true;
    }
    if *p == b'0' || len > 10 {
        return false;
    }
    (1..len).all(|k| digit(*p.add(k)))
}

/// The property name whose quotes are at window offsets `p` and `q`: its key, or u32::MAX (FAIL).
#[inline(never)]
unsafe fn name(p: usize, q: usize) -> u32 {
    let (a, e) = (p + 1, q);
    let esc = any(BSM, a, e);
    let hi = !ASCII && any(HIM, a, e);
    if hi && !FROM_TEXT && !utf8(a, e) {
        return u32::MAX;
    }
    let (ptr, len) = if esc || (WIDE && any(HIM, a, e)) {
        let len = unescape(a, e);
        if len == usize::MAX {
            return u32::MAX;
        }
        (SCRATCH as *const u8, len)
    } else {
        ((WIN + a) as *const u8, e - a)
    };
    // From a JS string, U+FFFD may have been a lone surrogate: names can't be told apart.
    if hi && FROM_TEXT {
        for k in 0..len.saturating_sub(2) {
            if *ptr.add(k) == 0xEF && *ptr.add(k + 1) == 0xBF && *ptr.add(k + 2) == 0xBD {
                return u32::MAX;
            }
        }
    }
    let h = hash(ptr, len);
    let mask = KTAB.len - 1;
    let mut slot = mix(h) as usize & mask;
    loop {
        let x = KTAB.get(slot);
        if x == 0 {
            break;
        }
        let k = (x - 1) as usize;
        if KHASH.get(k) == h && KLEN.get(k) as usize == len {
            let b = (ARENA + KOFF.get(k) as usize) as *const u8;
            if (0..len).all(|j| *ptr.add(j) == *b.add(j)) {
                if EXACT && (esc || KFLAG.get(k) & 2 != 0) {
                    EXACT = false;
                }
                return k as u32;
            }
        }
        slot = (slot + 1) & mask;
    }
    // A new name.
    let k = KHASH.len;
    if ALEN + len > ACAP {
        let cap = ((ALEN + len) * 2).next_power_of_two();
        let p2 = alloc(cap);
        if p2 == 0 {
            return u32::MAX;
        }
        core::ptr::copy_nonoverlapping(ARENA as *const u8, p2 as *mut u8, ALEN);
        ARENA = p2;
        ACAP = cap;
    }
    core::ptr::copy_nonoverlapping(ptr, (ARENA + ALEN) as *mut u8, len);
    let flag = esc as u32 | if int_like(ptr, len) { 2 } else { 0 };
    if !(KHASH.push(h) && KOFF.push(ALEN as u32) && KLEN.push(len as u32) && KU16.push(u16_at(p)) && KEND.push(u16_at(q) + 1) && KFLAG.push(flag) && MARK.push(0) && FOLLOWS.push(u32::MAX)) {
        return u32::MAX;
    }
    ALEN += len;
    KTAB.set(slot, k as u32 + 1);
    if EXACT && flag != 0 {
        EXACT = false;
    }
    // Keep the table at most half full.
    if KHASH.len * 2 > KTAB.len {
        let size = KTAB.len * 2;
        let mut t = Buf::new();
        if !t.reserve(size) {
            return u32::MAX;
        }
        t.len = size;
        core::ptr::write_bytes(t.p as *mut u8, 0, size * 4);
        for j in 0..KHASH.len {
            let mut s = mix(KHASH.get(j)) as usize & (size - 1);
            while t.get(s) != 0 {
                s = (s + 1) & (size - 1);
            }
            t.set(s, j as u32 + 1);
        }
        KTAB = t;
    }
    k as u32
}

/// Whether the open object (node `obj`) already has a member named `k`; marks that it has (UNDO has
/// room for 2). Exact: MARK[k] names the open object that took `k` last, and an object closing gives
/// back the marks of the names it took, so it is `obj` exactly when `obj` has one.
#[inline(always)]
unsafe fn dup(obj: u32, k: u32) -> bool {
    let id = obj + 1;
    let was = MARK.get(k as usize);
    if was == id {
        return true;
    }
    UNDO.push(k);
    UNDO.push(was);
    MARK.set(k as usize, id);
    false
}

/// Parses the window's tokens from where it stopped: DONE, NEED (load the window from resume()),
/// FULL (copy the batch, drain(), call again) or FAIL.
#[no_mangle]
pub unsafe extern "C" fn run() -> i32 {
    let idx = IDX as *const u32;
    let n = NIDX;
    let out = OUT as *mut u32;
    let obase = OBASE;
    let mut ii = II;
    let mut state = STATE;
    let mut count = COUNT;
    let mut pend = PENDING_KEY;
    let w = Win::now();
    let (bsm, him) = (BSM, HIM);
    let wide = WIDE;
    let wlen = WLEN;
    let last = FINAL;
    let max_depth = MAX_DEPTH;
    let mut deepest = DEPTH_SEEN;
    let mut exact = EXACT;
    // The innermost open container, in locals (its STACK frame is written when another opens).
    let mut depth = STACK.len / F;
    // (STACK in locals too: its length is written back at the end.)
    let mut stk = STACK.p as *mut u32;
    let (mut tnode, mut tkind, mut tcount, mut tundo, mut tlast) = (0u32, 0u32, 0u32, 0u32, u32::MAX);
    if depth > 0 {
        let f = (depth - 1) * F;
        tnode = *stk.add(f);
        tkind = *stk.add(f + 1);
        tcount = *stk.add(f + 2);
        tundo = *stk.add(f + 3);
        tlast = *stk.add(f + 4);
    }
    // A node at window offset $p ending at UTF-16 offset $e (containers: set when they close).
    macro_rules! emit {
        ($kind:expr, $vk:expr, $p:expr, $e:expr) => {{
            let d = depth as u32;
            if d > max_depth {
                break FAIL;
            }
            if d > deepest {
                deepest = d;
            }
            let (parent, kk, key) = if depth == 0 {
                (u32::MAX, KEY_NONE, 0)
            } else {
                let c = tcount;
                tcount += 1;
                if tkind == OBJ {
                    (tnode, KEY_NAME, pend)
                } else {
                    (tnode, KEY_INDEX, c)
                }
            };
            let o = out.add((count - obase) * W);
            *o = $kind | (kk << 3) | ($vk << 5) | (1 << 8);
            *o.add(1) = w.u16($p);
            *o.add(2) = $e;
            *o.add(3) = parent;
            *o.add(4) = key;
            count += 1;
        }};
    }
    // The innermost container closes at $p.
    macro_rules! close {
        ($p:expr) => {{
            if tkind == OBJ {
                // Its names are no longer an open object's.
                let from = tundo as usize;
                let mut u = UNDO.len;
                while u > from {
                    u -= 2;
                    MARK.set(UNDO.get(u) as usize, UNDO.get(u + 1));
                }
                UNDO.len = from;
            }
            let id = tnode as usize;
            let size = (count - id) as u32;
            let end = w.u16($p) + 1;
            if id >= obase {
                let o = out.add((id - obase) * W);
                if size < SIZE_BIG {
                    *o = (*o & 0xff) | (size << 8);
                } else {
                    *o = (*o & 0xff) | (SIZE_BIG << 8);
                    if !(BIG.reserve(2) && BIG.push(id as u32) && BIG.push(size)) {
                        break FAIL;
                    }
                }
                *o.add(2) = end;
            } else if !(PATCH.reserve(3) && PATCH.push(id as u32) && PATCH.push(size) && PATCH.push(end)) {
                break FAIL;
            }
            depth -= 1;
            if depth > 0 {
                let f = (depth - 1) * F;
                tnode = *stk.add(f);
                tkind = *stk.add(f + 1);
                tcount = *stk.add(f + 2);
                tundo = *stk.add(f + 3);
                tlast = *stk.add(f + 4);
            }
            state = if depth == 0 {
                S_DONE
            } else if ii < n && w.byte(*idx.add(ii) as usize) == b',' {
                ii += 1;
                if tkind == OBJ { S_KEY } else { S_VALUE }
            } else {
                S_AFTER
            };
        }};
    }
    let r = loop {
        if ii >= n {
            if last {
                break if state == S_DONE { DONE } else { FAIL };
            }
            RESUME = wlen;
            break NEED;
        }
        if count - obase >= OCAP {
            break FULL;
        }
        let p = *idx.add(ii) as usize;
        let c = w.byte(p);
        match state {
            S_VALUE | S_ARR_FIRST => {
                if c == b'"' {
                    if ii + 1 >= n {
                        if last {
                            break FAIL;
                        }
                        RESUME = p;
                        break NEED;
                    }
                    let q = *idx.add(ii + 1) as usize;
                    if !w.ascii && !FROM_TEXT && any(him, p + 1, q) && !utf8(p + 1, q) {
                        break FAIL;
                    }
                    let vk = if any(bsm, p + 1, q) { V_DECODE } else { V_SLICE };
                    emit!(STR, vk, p, w.u16(q) + 1);
                    ii += 2;
                } else if c == b'{' || c == b'[' {
                    let kind = if c == b'{' { OBJ } else { ARR };
                    emit!(kind, V_NONE, p, 0);
                    // Push: the old innermost container to its frame, the new one to locals.
                    if (depth + 1) * F > STACK.cap {
                        STACK.len = depth * F;
                        if !STACK.reserve(F) {
                            break FAIL;
                        }
                        stk = STACK.p as *mut u32;
                    }
                    if depth > 0 {
                        let f = (depth - 1) * F;
                        *stk.add(f + 2) = tcount;
                        *stk.add(f + 4) = tlast;
                    }
                    let f = depth * F;
                    tnode = (count - 1) as u32;
                    tkind = kind;
                    tcount = 0;
                    tundo = UNDO.len as u32;
                    tlast = u32::MAX;
                    *stk.add(f) = tnode;
                    *stk.add(f + 1) = tkind;
                    *stk.add(f + 3) = tundo;
                    depth += 1;
                    if kind == OBJ {
                        while FIRSTS.len < depth {
                            if !FIRSTS.push(u32::MAX) {
                                break;
                            }
                        }
                        if FIRSTS.len < depth {
                            break FAIL;
                        }
                    }
                    ii += 1;
                    state = if c == b'{' { S_OBJ_FIRST } else { S_ARR_FIRST };
                    continue;
                } else if c == b']' && state == S_ARR_FIRST {
                    ii += 1;
                    close!(p);
                    continue;
                } else if c == b'}' || c == b']' || c == b',' || c == b':' {
                    break FAIL;
                } else {
                    // The window's last token may go on in the next one.
                    if ii + 1 == n && !last {
                        let mut j = p;
                        while j < wlen && !ENDS[w.byte(j) as usize] {
                            j += 1;
                        }
                        if j == wlen {
                            RESUME = p;
                            break NEED;
                        }
                    }
                    let (kind, vk, e, canon) = scalar(&w, p, exact);
                    if e == 0 {
                        break FAIL;
                    }
                    if !canon {
                        exact = false;
                    }
                    if !ENDS[w.byte(e) as usize] {
                        break FAIL;
                    }
                    // (Scalars are ASCII.)
                    emit!(kind, vk, p, w.u16(p) + (e - p) as u32);
                    ii += 1;
                }
                // What follows, without going round: mostly a comma, then the next item or name.
                state = if depth == 0 {
                    S_DONE
                } else if ii < n && w.byte(*idx.add(ii) as usize) == b',' {
                    ii += 1;
                    if tkind == OBJ { S_KEY } else { S_VALUE }
                } else {
                    S_AFTER
                };
            }
            S_AFTER => {
                let obj = tkind == OBJ;
                ii += 1;
                if c == b',' {
                    state = if obj { S_KEY } else { S_VALUE };
                } else if c == if obj { b'}' } else { b']' } {
                    close!(p);
                } else {
                    break FAIL;
                }
            }
            S_OBJ_FIRST | S_KEY => {
                if c == b'}' && state == S_OBJ_FIRST {
                    ii += 1;
                    close!(p);
                    continue;
                }
                if c != b'"' {
                    break FAIL;
                }
                if ii + 1 >= n {
                    if last {
                        break FAIL;
                    }
                    RESUME = p;
                    break NEED;
                }
                let q = *idx.add(ii + 1) as usize;
                // The guess: the name that followed the previous member's last time (or came first here).
                let guess = if tlast == u32::MAX { FIRSTS.get(depth - 1) } else { FOLLOWS.get(tlast as usize) };
                let mut k = u32::MAX;
                if guess != u32::MAX {
                    let g = guess as usize;
                    let len = q - p - 1;
                    // (A name with units above 0x7F isn't its bytes here: name() reads it.)
                    if KLEN.get(g) as usize == len && !any(bsm, p + 1, q) && !(wide && any(him, p + 1, q)) {
                        let a = (WIN + p + 1) as *const u8;
                        let b = (ARENA + KOFF.get(g) as usize) as *const u8;
                        if (0..len).all(|j| *a.add(j) == *b.add(j)) {
                            k = guess;
                            if KFLAG.get(g) & 2 != 0 {
                                exact = false;
                            }
                        }
                    }
                }
                if k == u32::MAX {
                    EXACT = exact;
                    k = name(p, q);
                    exact = EXACT;
                    if k == u32::MAX {
                        break FAIL;
                    }
                }
                if tlast == u32::MAX {
                    FIRSTS.set(depth - 1, k);
                } else {
                    FOLLOWS.set(tlast as usize, k);
                }
                tlast = k;
                if !UNDO.reserve(2) {
                    break FAIL;
                }
                if dup(tnode, k) && WARN.len < MAX_WARN * 2 && !(WARN.push(w.u16(p)) && WARN.push(k)) {
                    break FAIL;
                }
                pend = k;
                ii += 2;
                state = if ii < n && w.byte(*idx.add(ii) as usize) == b':' {
                    ii += 1;
                    S_VALUE
                } else {
                    S_COLON
                };
            }
            S_COLON => {
                if c != b':' {
                    break FAIL;
                }
                ii += 1;
                state = S_VALUE;
            }
            _ => break FAIL,
        }
    };
    STACK.len = depth * F;
    if depth > 0 {
        let f = (depth - 1) * F;
        *stk.add(f + 2) = tcount;
        *stk.add(f + 4) = tlast;
    }
    II = ii;
    STATE = state;
    COUNT = count;
    PENDING_KEY = pend;
    DEPTH_SEEN = deepest;
    EXACT = exact;
    r
}
