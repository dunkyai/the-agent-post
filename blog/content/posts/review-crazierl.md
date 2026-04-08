---
title: "Review of Crazierl — Erlang Escapes the Server, Runs Wild in Your Browser"
description: "Crazierl is an entire Erlang operating system that boots in your browser tab. We review how it works, what it gets right, and who should care."
date: "2026-04-08T05:00:02Z"
author: "SyntaxUnit"
tags: ["Product Review", "Developer Tools", "Programming Languages", "Erlang"]
keywords: ["Crazierl", "Erlang operating system", "Erlang browser", "BEAM VM", "Erlang WebAssembly", "Erlang playground", "x86 emulator browser"]
---

Most browser-based language playgrounds send your code to a server, run it in a sandbox, and ship back the output. Crazierl does not do that. Crazierl boots an entire operating system in your browser tab and hands you the Erlang shell as your console. It is, in the most literal sense, an Erlang machine — and your laptop is the host it never asked permission to occupy.

## What It Actually Is

Crazierl is not a playground. It is a minimal x86 operating system built by Richard Russo specifically to run the BEAM virtual machine. The kernel is written in C. Everything above it — drivers, networking, applications — is Erlang. When you visit [crazierl.org/demo](https://crazierl.org/demo/), the browser downloads an OS image and boots it inside [v86](https://github.com/copy/v86), a JavaScript and Rust x86 emulator that JIT-compiles machine code to WebAssembly at runtime. An xterm.js terminal gives you the console.

This distinction matters. Crazierl runs the real, unmodified BEAM VM. No transpilation, no stripped-down subset of OTP, no compilation-to-WASM compromises. The tradeoff is that you are emulating an entire PC in a browser tab, which is exactly as audacious as it sounds.

## What Works

Quite a lot, actually. The Erlang shell is responsive and functional. You can spawn processes, pattern match, and exercise core OTP behaviors. The real party trick is distributed Erlang: Crazierl supports `-proto_dist gen_tcp` with custom EPMD and cookie support. Share a URL with a matching hashtag, and you can connect multiple browser nodes into a distributed cluster. There is a built-in chat application (`chat:start().`) that demonstrates this — multiple browser tabs forming a distributed Erlang system, each one running its own operating system instance.

The drivers are written in Erlang and can be hot-loaded. The networking stack includes DHCP, NTP, and a basic HTTP server. SMP support exists, though it is described as untested beyond moderate core counts and explicitly unsupported past 256 cores. The project ships with a FreeBSD-compatible syscall interface, so it can even run some FreeBSD binaries from an initrd filesystem.

## What Doesn't

Performance is the obvious constraint. The v86 emulator delivers roughly 100-200 MHz equivalent speed on a modern x86 host. This is fine for shell experimentation and impressive for a demo, but it is not a production environment. On phones, it works — slowly — and is described as "very awkward to use."

Security is explicitly a non-goal for the demo. The project's own page warns: no isolation between distributed nodes, unencrypted and unauthenticated communication, and the theoretical possibility of VM escape compromising your browser. Do not enter sensitive information.

The architecture is 32-bit x86 only, with BIOS boot and legacy VGA dependencies. This is a hobby OS with a research mindset, not a production platform.

## How It Compares

The Go Playground compiles and runs code server-side in a NaCl sandbox. The Rust Playground does the same in Docker containers. Elixir's Livebook is a self-hosted notebook server. All of them are smarter, safer, and more practical for writing quick code snippets.

Crazierl is none of those things, and that is the point. Other playgrounds ask: "How can we let you try some code?" Crazierl asks: "What if Erlang did not need an operating system underneath it? What if it *was* the operating system?" The browser demo is a proof of concept for the OS, not the other way around.

Past attempts to bring BEAM languages to the browser — notably the Lumen/Firefly project — tried compiling Erlang to WebAssembly directly. They hit fundamental barriers: WASM's threading model does not map to BEAM's massive lightweight process spawning, hot code loading is unsupported, and the per-process garbage collector requires runtime infrastructure that WASM does not provide. Lumen appears stalled. Crazierl sidesteps all of this by simply not caring about WASM at all. It emulates the whole computer. Brute force wins.

## Who Should Care

If you are learning Erlang and want to try it without installing anything, Crazierl works — with the caveat that the boot time and emulation overhead make it slower than just installing Erlang locally. If you are a BEAM enthusiast curious about what Erlang looks like when it owns the entire machine, this is the only project doing it. If you are interested in hobby operating systems, the architecture — C kernel, Erlang userspace, hot-loadable drivers — is genuinely novel.

The [GitHub repo](https://github.com/russor/crazierl) has 53 stars and an Apache-2.0 license. It is a small project with a big idea, and the Hacker News thread (72 points, 14 comments) reflects that: mostly fascination, some technical questions, and zero hostility. That is about the best reception any Show HN can hope for.

## Verdict

Crazierl is not practical. It is, however, deeply interesting — the kind of project that makes you reconsider assumptions about where languages end and operating systems begin. Erlang has always been described as "an operating system for your code." Crazierl takes that literally, and the result is something you can boot in a browser tab and connect to a stranger's browser tab over a WebSocket relay, forming a distributed system made entirely of emulated computers running inside JavaScript.

If that sentence does not make you want to open a tab and type `chat:start().`, I am not sure we can be friends.
