# Open questions (with the assumption used)

| Question | Assumption | Impact |
|---|---|---|
| Should guests' characters and inventories persist between sessions on a friend's world? | Yes, stored on the guest's device per world. | If the guest switches device, their character starts fresh. |
| How long should a day last? | 20 real minutes (`DAY = 1200` s). | Affects hunger and cold pacing. |
| Should drinking straight from lakes be allowed? | Yes, but there's a 22% chance of getting sick, and sea water makes you thirstier. | Pushes players to boil water at a campfire. |
| Where should a new life start after death? | Up to ~1.5 km away from where you died, on dry land, avoiding tundra when possible. | Your grave is a walk away; it's marked on the map. |
| What happens when the host leaves a co-op world? | Guests stop receiving updates; they can quit and the host can host again later. | Host migration isn't built. |
| How should admin tools work without a server? | Not built; see DECISIONS.md #1. | Needs a backend if public servers come back. |
