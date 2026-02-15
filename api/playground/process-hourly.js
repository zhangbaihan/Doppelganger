import { processHourlyInteractions } from '../_lib/playgroundEngine.js';
import { apiHandler } from '../_lib/handler.js';

// This endpoint can be called by a cron job or scheduled function
// For now, we'll make it accessible via API (you may want to add auth)
export default apiHandler(async (req, res) => {
  // Optional: Add secret key check for cron jobs
  // const cronSecret = req.headers['x-cron-secret'];
  // if (cronSecret !== process.env.CRON_SECRET) {
  //   return res.status(401).json({ error: 'Unauthorized' });
  // }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const result = await processHourlyInteractions();
    return res.json(result);
  } catch (err) {
    console.error('Process hourly error:', err);
    return res.status(500).json({ error: 'Failed to process hourly interactions', details: err.message });
  }
});
