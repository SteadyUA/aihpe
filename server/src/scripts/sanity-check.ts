import express from 'express';

const app = express();
const port = 5001;

app.get('/sanity', (req, res) => {
    res.send('sanity-pong');
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Sanity server running on http://0.0.0.0:${port}`);
});
