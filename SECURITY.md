# Security Policy

## Supported versions

Only the latest commit on `main` gets security fixes.

## Reporting a vulnerability

**Do not open a public issue for security problems.**

Report privately using either:

- GitHub's [private vulnerability reporting](https://github.com/Lameda12/vivomusicano/security/advisories/new), or
- the contact form at [alamedinsabit.me](https://alamedinsabit.me).

Please include steps to reproduce, the affected browser and OS, and the impact you expect. You will get a reply within 7 days. Please give us 90 days to ship a fix before you disclose publicly. Reporters are credited unless they ask not to be.

## What counts

We especially want to hear about anything that could:

- send camera frames, hand landmarks, or audio off the device,
- run script from a pasted song or a crafted localStorage value (XSS),
- keep the camera or microphone active after the user stops the app.
