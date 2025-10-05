# nasaspaceapps-skycheck-backend

API for the SkyCheck project — responsible for querying weather providers, unifying and transforming the data (forecast, nowcast, climatology fallback), and delivering it to the Frontend using a single, easy-to-consume model.

## Description

NasaSpaceApps-SkyCheck-Backend is the data brain of SkyCheck.
It exposes a main endpoint that:

- Accepts a coordinate (lat, lon), a target datetime (targetISO), and a time zone.
- Queries Meteomatics (and enforces the provider’s real forecast horizon limits).
- Computes derived metrics (daily high/low, precipitation accumulations, “very hot / very wet / dangerous UV”, etc.).
- Generates deterministic alerts based on configurable thresholds.
- If the requested date is outside the provider’s horizon, returns a climatology (hourly historical medians around that date) as a fallback.

The goal is to provide a clear and reliable data layer for the end-user experience.

## Technologies

| Type | Tool |
|------|--------------|
| Primary language | TypeScript |
| Framework | Express |
| Validation | Zod |
| Dates & Timezone | date-fns-tz |
| HTTP client | fetch/axios (per services/meteomatics) |
| CORS/security | cors, dotenv |
| Version control | Git / GitHub |

## Installation and Execution

1. Clone the repository
   ```bash
   git clone https://github.com/<tu-org>/SkyCheck-Backend.git
    cd SkyCheck-Backend

## Instalación y uso

To install the dependancies, run the command `npm install` in the terminal of the root directory of the project.  
Then, t up the environment by creating a `.env` in the root of the repository with the required variables, for example:

    # Server port
    PORT=3001

    # Allowed origins (comma-separated)
    CORS_ORIGINS=http://localhost:5173

    # Meteomatics credentials
    METEOMATICS_USERNAME=tu_usuario
    METEOMATICS_PASSWORD=tu_password

    # Maximum forecast days before fallbak to climatology
        METEOMATICS_MAX_FORECAST_DAYS=14
    

Once configured, run the command `npm run dev`.  If you want to generate the optimized production version, use `npm run build`.

## Project Structure

The project is organized as follows:

The `NasaSpaceApps-SkyCheck-Backend/` directory is organized as follows contains the main folders.  
Inside `src/` you will find the resources and components of the backend:

- `routes/`: HTTP route controllers.  
- `services/`: clients for external providers.  
- `utils/`: business/domain utilities.  
- `middlewares/`: optional middlewares (CORS, logging, custom error handling).
- `config/`: loads environment variables and constants (e.g., forecast horizon limits, credentials). 
- `types/`: shared TypeScript definitions (interfaces for provider responses and the API).
- `index.ts`: Express bootstrap (starts the server, sets up CORS, mounts routes).

## Available Scripts

The project includes the following commands:

- `npm run dev`: starts the server in development mode with auto-reload (nodemon/ts-node-dev).
- `npm run build`: compiles TypeScript to JavaScript into dist/ (tsc). 
- `npm run start`: launches the production server from dist/ (node).  
- `npm run lint`: analyzes the code with ESLint to catch errors and bad practices.

## Licence

SkyCheck © 2025 by Zuleyca Balles, Regina Orduño, Mariana Carrillo, Libia Flores, Diana Escalante, and Mariana Islas is licensed under CC BY-ND 4.0