# Dental Lab Register

Setup (run inside this folder):

1. Stop any old server still running on port 3000.
2. `npm install`
3. `npm run setup`   -> creates `.env` and `.gitignore`
4. Open `.env` and paste your Neon pooled connection string as DATABASE_URL
5. `npm run migrate` -> prints "Schema applied"
6. `node scripts/create-user.js yourname "YourStrongPass123" admin`
7. `npm run dev`
8. Open http://localhost:3000/health -> must show "build":"brick-2"
9. Open http://localhost:3000 -> redirects to the login page
