import express from 'express';

const app = express();
const port = Number(process.env.PORT ?? 4000);

app.use(express.json());

app.listen(port, () => {
  console.log(`Mock API listening on port ${port}`);
});
