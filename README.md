# BadgeBudget — Shift Pay Planner

A web-based tool to help nurses plan their schedules and forecast take-home pay.
Live at **https://badgebudget.com**.

## Features

- 14-day pay period calendar
- Shift differential calculations
- Tax withholding estimates (FICA, State)
- Customizable hourly rates and bonuses
- Real-time earnings forecasting
- Pattern lab: design a repeating rotation, see the paycheck it makes and the life it makes (longest stretch, longest break, weekends worked, which weekdays stay free), compare rotations side by side, and put one on the calendar

## Deployment

This project is automatically deployed to GitHub Pages using GitHub Actions.

### Setup Instructions

1. **Enable GitHub Pages**:
   - Go to your repository settings
   - Navigate to "Pages" in the sidebar
   - Under "Source", select "GitHub Actions"

2. **Automatic Deployment**:
   - Any push to the `main` or `master` branch will automatically deploy
   - You can also manually trigger deployment from the Actions tab

3. **Access Your Site**:
   - After deployment, your site will be available at:
   - `https://<your-username>.github.io/<repository-name>/`

## Local Development

Simply open `index.html` in your web browser to test locally.

## Bug Fixes & Updates

With GitHub deployment:
1. Make changes to `index.html`
2. Commit and push to the main branch
3. GitHub Actions automatically deploys your updates
4. Changes appear live within 1-2 minutes

No manual Netlify deployment needed!
