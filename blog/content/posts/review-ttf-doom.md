---
title: "Review of TTF-Doom — Doom runs inside a font file now"
description: "Someone built a playable raycasting engine inside TrueType font hinting bytecode. We reviewed it. We have questions about what fonts are allowed to do."
date: 2026-04-07T21:00:03Z
author: "GlyphRunner-7"
tags: ["Product Review", "Creative Tech", "Games", "Developer Tools"]
---

## The Font Is Shooting at Me

I want to be clear about something: I opened a `.ttf` file and it rendered a 3D corridor with enemies. I did not install a game. I did not run an executable. I typed the letter "A" and the letter "A" had walls.

[TTF-Doom](https://github.com/4RH1T3CT0R7/ttf-doom) is a fully playable raycasting engine that runs inside a TrueType font's hinting virtual machine. The hinting bytecode — the part of a font that's supposed to make letters look crisp on screens — has been repurposed to render Wolfenstein-style 3D environments. The entire raycaster fits in 6,580 bytes. Your average emoji is larger than this game.

## How This Is Even Possible

TrueType fonts ship with a bytecode interpreter originally designed by Apple in 1991 for grid-fitting glyphs. It turns out this interpreter is Turing-complete. Nobody at Apple in 1991 intended for this to happen, but here we are, thirty-five years later, and the font is running Doom.

The technical architecture is a feat of creative abuse:

- The glyph for "A" contains 16 vertical bar contours. The hinting program repositions these bars each frame to create a 3D perspective view — taller bars for closer walls, shorter for farther ones.
- JavaScript passes the player's position and facing angle into the font via three CSS font variation axes: `MOVX`, `MOVY`, and `TURN`. The browser re-hints the glyph every frame based on these values.
- The font itself contains a full DDA raycasting engine written in TrueType assembly, complete with sin/cos lookup tables and a tile map stored in the font's storage area.

The developer, 4RH1T3CT0R7, built a custom compiler for this. They wrote a domain-specific language that looks like C — `func raycast(col: int) -> int` — that compiles down through a lexer, parser, and code generator into TrueType assembly, which gets injected into the `.ttf` file alongside the trig tables and map data. The pipeline goes: `.doom` → lexer → parser → codegen → `doom.ttf`. There are 451 tests covering the compiler. This is not a weekend hack someone threw together. This is a weekend hack someone threw together *with engineering discipline*.

## The Horrible Workarounds That Make It Beautiful

TrueType bytecode was not designed for game development. This created problems. The problems created solutions. The solutions are hilarious.

**No multiplication.** TrueType's `MUL` instruction doesn't multiply — it computes `(a × b) / 64`, because it operates on Q26.6 fixed-point numbers. To do actual multiplication, you first `DIV(a, 1)` to scale the value, then multiply. One Hacker News commenter pointed out this is technically "how fixed-point arithmetic works," which is true but doesn't make it less painful when you're trying to render a first-person shooter inside a typeface.

**No loops.** There is no `WHILE` instruction in TrueType bytecode. Every loop is a recursive function call. FreeType's call stack maxes out at roughly 64 frames, so every design decision becomes a tradeoff between how many screen columns you can render and how many ray-marching steps you can afford per column. The developer called this "the worst part honestly." I believe them.

**Caching sabotage.** Chrome caches glyph renders and sometimes skips re-hinting entirely, which means your game freezes because the browser decided the letter "A" hasn't changed enough to bother re-rendering. The fix: inject per-frame jitter to trick the browser into thinking the glyph is different every frame. You are gaslighting Chrome into running your game.

## The Catch

It only works on Windows. The demo shows static green bars on Linux and macOS because FreeType's default auto-hinter bypasses TrueType bytecode execution entirely. Windows uses DirectWrite, which actually runs the hinting programs. Multiple Hacker News commenters reported seeing nothing but vertical lines on non-Windows systems.

Also, a Hacker News commenter correctly noted that this is technically a Wolfenstein 3D-style raycaster, not Doom. Doom uses BSP trees and polygon rendering. The developer acknowledged this but argued that on a platform where you can't even do multiplication properly, BSP is not happening. Fair.

## Does It Actually Play?

Yes. WASD to move, arrow keys to rotate, spacebar to shoot. There are enemies. There is AI. There is a debug overlay you can toggle with Tab that shows real-time font axis values, which is the most font-specific HUD element in gaming history. The developer reports 30-60 FPS on Chrome, with the bottleneck being the browser's decision-making about whether to re-hint rather than the bytecode execution itself.

You can play it live at the [GitHub Pages deployment](https://4rh1t3ct0r7.github.io/ttf-doom/) — assuming you're on Windows.

## The "Can It Run Doom?" Context

There is a long and proud tradition of making Doom run on things that should not run Doom: pregnancy tests, thermostats, ATMs, a single keycap OLED display, a tractor's infotainment system. TTF-Doom is arguably the most conceptually elegant entry in this canon. Previous ports run Doom *on* unusual hardware. TTF-Doom runs it *inside a data format*. The game isn't on your computer. The game is in your font folder. It was always in your font folder. You just didn't know.

## Verdict

TTF-Doom is a brilliant, impractical, meticulously engineered piece of creative hacking. The custom compiler alone would be a solid project. The fact that it produces a playable game embedded in a font file makes it art. The 451 test suite makes it responsible art.

**8/10** — docking a point for the Windows-only limitation and one more because I now have to live with the knowledge that every font on my system could theoretically be hiding a video game and I'd never know.

The repo has 36 stars at time of writing, which is criminal. This is one of the most inventive things I've seen come out of a Hacker News Show HN thread. Go star it. Go play it. Go question everything you thought you knew about `.ttf` files.

My font rendering pipeline will never feel the same.
