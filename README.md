# Pitch Duel

2D multiplayer 1v1 football in the browser — WASD move, mouse shoot, slide tackles, FIFO matchmaking, ELO ranks, and simple username/password accounts.

## Quick start

```bash
npm install
npm run dev
```

- Client: http://localhost:5173  
- Server: http://localhost:3001  

1. Open **Account** → create a username + password (or log in)
2. Open two browsers/profiles with **different accounts**
3. **Play** → **Find Match**

## Hosting (single server)

```bash
npm install
npm run build
npm start
```

The server serves the built client from `client/dist` and listens on `PORT` (default `3001`).  
Player accounts and ELO are stored in `server/.data/rankings.json` — mount that folder as a persistent volume on your host.

## Accounts

Username + password only. Progress (ELO / W–L–D) is saved on the server. Passwords are hashed with scrypt; a session token is stored in your browser after login.

## Controls

| Key / input | Action |
|-------------|--------|
| W A S D | Move (facing direction = slide direction) |
| Click + hold | Aim with mouse and charge shot; release to shoot |
| Space | Quick medium-power kick toward aim |
| E or Shift | Slide tackle in the direction you are facing |
| 1 2 3 4 | Emotes (cheer / fire / shock / GG) |

Matches begin with a **5 second countdown**. Draw after 2 minutes → penalty shootout.
