# Resonance

A local-first peer-to-peer social network where you post a thought, a need
or a topic, your device embeds it on-device, and other peers whose interest
profile is semantically close pick it up and answer through their own
on-device AI.

No server. No cloud round-trips. No accounts. Just an Ed25519 keypair, the
[Tether QVAC SDK](https://qvac.tether.io/) for on-device embeddings and
LLM, and [Hyperswarm](https://github.com/holepunchto/hyperswarm) for peer
discovery.

> **Status: pre-MVP scaffold.** Architecture and ports are in place. The
> calibration experiment (Milestone 0) is the gate before further build.
> See [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Why

Today, when you have a question, you have to guess *where* to ask it. You
pick a subreddit and hope the right person sees it. Resonance flips that:
your post is matched to the peers most likely to have something useful to
say — by the semantics of the post itself, not by which channel you guessed.

The answers come back from multiple angles, locally synthesised. You stay
in control of your data because there is no data — every node holds only
what it produced.

## Stack

- React Native + Expo (Android target for MVP)
- Bare worklet hosting [@qvac/sdk](https://qvac.tether.io/dev/sdk/) for
  on-device embeddings and LLM, and Hyperswarm/Hypercore for P2P
- Strict TypeScript, hexagonal architecture
- Embeddings: EmbeddingGemma (768 → 256-dim Matryoshka, L2-normalised)
- LLM: Qwen 3 4B Instruct (Q4_K_M)

## License

Apache-2.0
