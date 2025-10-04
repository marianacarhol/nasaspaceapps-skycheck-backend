import 'dotenv/config';
import express from 'express';
import morgan from 'morgan';
import healthRouter from './routes/health';
import riskRouter from './routes/risk';

const app = express();
app.use(express.json());
app.use(morgan('dev'));

app.use('/health', healthRouter);
app.use('/risk', riskRouter);

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});