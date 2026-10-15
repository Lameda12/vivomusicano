# Privacy Policy

_Last updated: October 15, 2026_

This policy covers the VIVO web app built from this repository and any official deployment of it run by Alamedin Sabit ("we", "us"). Contact: [alamedinsabit.me](https://alamedinsabit.me).

## Summary

- **Your camera video never leaves your device.** Hand tracking runs locally in your browser.
- **No account, no analytics, no ads, no cookies.**
- **We don't sell, rent, or share personal data**, because the app doesn't collect any.

## 1. Camera

VIVO asks for camera access to detect your hand positions. Frames are processed in your browser by the MediaPipe hand-tracking model, which runs on your own device (GPU or CPU). Frames and hand landmarks are:

- not uploaded, stored, or recorded,
- not used to identify you. VIVO tracks 21 points per hand; it does not do face recognition or biometric identification,
- discarded right after each frame is processed.

The camera turns off when you close or reload the tab. You can revoke permission at any time in your browser's site settings.

## 2. Microphone

The current app does not use your microphone. If a future feature needs it, we will update this policy and ask for permission first.

## 3. Data stored on your device

Custom songs you create are saved in your browser's `localStorage` under the key used by the app. This data stays on your device, is never sent to us, and can be deleted by clearing site data in your browser. We use no cookies.

## 4. Network requests

When you load the app, your browser downloads the app's code, the hand-tracking model, and fonts **from the same server that hosts the app**. The app makes no requests to third-party services while running.

The hosting provider of an official deployment (for example Vercel) may keep standard server logs such as IP address, user agent, and request time for security and operations. Those logs are governed by the host's privacy policy. If you run VIVO yourself, you are the operator and this section applies to your host instead.

## 5. Children

VIVO is not directed at children under 13 (or the minimum age in your country) and collects no personal data from anyone. Children should use it with a parent or guardian.

## 6. Your rights (GDPR, UK GDPR, CCPA/CPRA, PIPEDA and similar laws)

Because we don't collect or process personal data through the app, there is generally nothing for us to access, correct, export, or delete. You still have the right to ask us what we hold about you, and we will answer. For EU/UK users, the legal basis for processing camera frames on your own device is your consent, which you can withdraw by revoking camera permission.

## 7. Future app and paid features

The planned VIVO mobile and desktop apps and the optional Pro tier (see [ROADMAP.md](../ROADMAP.md)) may need things like an account, payment, or cloud sync. Those products will have their own privacy policy, published before launch, and will tell you exactly what they collect. Nothing in this open-source web app will start collecting data without an update to this policy.

## 8. Forks and third-party deployments

Anyone can fork VIVO under the MIT license. We are not responsible for the privacy practices of modified versions or deployments run by others. Check who operates the site you are using.

## 9. Changes

We will post changes here and update the date above. Significant changes will be noted in the release notes.

## 10. Contact

Questions or requests: [alamedinsabit.me](https://alamedinsabit.me).
