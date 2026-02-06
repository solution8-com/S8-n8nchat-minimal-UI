module.exports = async function (context, req) {
  const webhookUrl = process.env.N8N_WEBHOOK_URL;

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });

    const data = await response.json();

    context.res = {
      status: response.status,
      body: data,
      headers: { 'Content-Type': 'application/json' }
    };
  } catch (error) {
    context.res = {
      status: 500,
      body: { error: error.message }
    };
  }
};
