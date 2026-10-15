# Roadmap

Vivomusicano turns your hands into a band that follows a singer. This is where it's heading. Dates are targets, not promises.

## Now: open-source web app (free forever)

Everything in this repository stays free and MIT-licensed:

- Hand-tracked chord advance (swipe and fist) and expressive control (volume, filter)
- Follow and Auto modes
- Pad, Keys, Pluck presets with voice-leading
- Built-in songs plus custom progressions
- Runs fully on-device, no account, no tracking

## Next: community features (open source, contributions welcome)

- [ ] Unit tests for the chord parser and gesture state machines
- [ ] More presets (strings, organ, choir, 808 bass)
- [ ] MIDI out over Web MIDI, so Vivomusicano can drive any DAW or hardware synth
- [ ] Shareable song links (progression encoded in the URL, no server)
- [ ] Gesture calibration screen (per-user swipe speed and pinch range)
- [ ] Keyboard and screen-reader accessibility pass
- [ ] Translations of the UI

## Coming soon: Vivomusicano app

Native apps for **iOS, Android, and desktop** are in development, with lower latency and offline use. Want early access? Sign up through [alamedinsabit.me](https://alamedinsabit.me) and watch this repo's releases.

## Planned: Vivomusicano Pro (freemium)

The core stays free. An optional paid tier is planned for features with ongoing costs or that serve heavy users:

| Free (this repo) | Pro (planned) |
|---|---|
| 3 presets | Full sound library and premium sample instruments |
| Custom songs in your browser | Cloud sync of songs and setlists across devices |
| Live play | Record and export performances (audio and video) |
| Chord progressions | Chord charts imported from popular formats, transpose, capo |
| Hand gestures | Custom gesture mapping, foot pedal and MIDI controller input |
| Solo | Multiplayer jam sessions (several players, one song) |
| — | Setlist mode for live shows, stage view, backup triggers |

Pricing is not decided yet. Nothing that is free today will move behind the paywall. Pro features will be built in a separate codebase; the open-source app will never require an account.

## Have an idea?

Open a [feature request](https://github.com/Lameda12/vivomusicano/issues/new?template=feature_request.yml) or start a [Discussion](https://github.com/Lameda12/vivomusicano/discussions).
