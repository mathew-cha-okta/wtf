import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as crypto from 'crypto';
import { request } from 'https';

import { acronyms } from './acronyms';

const VERIFICATION_TOKEN: string = process.env.SLACK_VERIFICATION_TOKEN || '';
const OAUTH_ACCESS_TOKEN: string = process.env.SLACK_OAUTH_ACCESS_TOKEN || '';
const SIGNING_SECRET: string = process.env.SLACK_SIGNING_SECRET || '';

type SlackElement = {
  type: string;
  user_id?: string;
  text?: string;
  elements?: SlackElement[];
};

type SlackBlock = {
  type: string;
  block_id: string;
  elements: SlackElement[];
}

type SlackEvent = {
  type: string;
  client_msg_id: string;
  text: string;
  user: string;
  ts: string;
  team: string;
  blocks: SlackBlock[];
  channel: string;
  event_ts: string;
}

type Body = {
  type: string;
  event_id: string;
  event_time: string;
  challenge: string;
  token: string;
  text: string;
  event: SlackEvent;
  authed_users: string[];
}


const verifySignature = (signature='', timestamp='', body='') => {
  const hmac = crypto.createHmac('sha256', SIGNING_SECRET);
  const [version, hash] = signature.split('=');
  hmac.update(`${version}:${timestamp}:${body}`);
  const a = Buffer.from(hash ?? '', 'hex');
  const b = hmac.digest();
  if (a.length !== b.length) {
    console.error(`a ${a.toString('utf8')} is not the same length as b ${b.toString('utf8')}`);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
};

const isChallenge = (event: APIGatewayProxyEvent, body: Body) => {
  if (event.requestContext.httpMethod !== 'POST') {
    return false;
  }
  if (body.type !== 'url_verification') {
    return false;
  }
  if (body.token !== VERIFICATION_TOKEN) {
    return false;
  }
  return true;
};

const reply = async (event: SlackEvent, definitions: string[]) => new Promise((a, r) => {
  const url = new URL(`https://slack.com/api/chat.postMessage`);
  const body = {
    channel: event.channel,
    text: definitions.join(' OR '),
  };

  const rawBody = JSON.stringify(body);

  const headers = {
    Authorization: `Bearer ${OAUTH_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
    'Content-Length': rawBody.length,
  };
  const req = request(url, { headers, method: "POST" }, res => {
    res.on('data', chunk => { console.log(`Response: ${chunk}`); });
    res.on('close', a);
  });
  req.on('error', e => {
    console.error(e.message);
    r(e);
  });
  req.write(rawBody);
  req.end();
});


export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const body: Body = JSON.parse(event.body ?? '{}');
  const signature = event.headers['X-Slack-Signature'];
  const timestamp = event.headers['X-Slack-Request-Timestamp'];

  console.log(signature, timestamp);
  if (!verifySignature(signature, timestamp, event.body ?? '')) {
    return {
      statusCode: 401,
      body: 'Signature verification failed. You are not Slack!',
    };
  }

  if (isChallenge(event, body)) {
    return {
      statusCode: 200,
      headers: { 'content-type': 'text/plain' },
      body: body?.challenge,
    };
  }
  console.log(JSON.stringify(body));
  const slackEvent: SlackEvent = body.event;
  if (slackEvent.type !== 'app_mention') {
    // Don't care.
    return {
      statusCode: 204,
      body: '',
    };
  }

  const chunks = slackEvent.blocks
    .filter(b => b.type === 'rich_text')
    .reduce((accum: string[], b: SlackBlock) => {
      const text: string[] = [];
      b.elements.map(element => element.elements?.filter(e => e.type === 'text').forEach(e => e.text && text.push(e.text)));
      return text;
    }, []);
  console.log('chunks', chunks);
  const string = chunks.join(' ').trim();
  console.log(string);

  const definitions = acronyms[string] || [`No definition found for ${string}`];
  console.log('definition', definitions);
  await reply(slackEvent, definitions);
  const response = {
    statusCode: 200,
    body: JSON.stringify({ text: 'acronym' }),
  };
  return response;
};