// src/index.ts
import 'dotenv/config';
import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import helmet from 'helmet';

import healthRouter from './routes/health.js';
import riskRouter from './routes/risk.js';
import dashboardRouter from './routes/dashboard.js';
import geocodeRouter from './routes/geocode.js'; // 👈 NUEVO

const app = express();

app.use(helmet());
app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:3001'] }));
app.use(express.json());
app.use(morgan('dev'));

app.use('/health', healthRouter);
app.use('/risk', riskRouter);
app.use('/dashboard', dashboardRouter);
app.use('/geocode', geocodeRouter); // 👈 NUEVO

// 404
app.use((req, res) => res.status(404).json({ error: 'Not Found' }));

// Error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`API on http://localhost:${port}`));