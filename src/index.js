const express = require('express');
const Imap = require('imap');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const POP3Cliente = require('node-pop3')
// process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0
require('dotenv').config()

const app = express();
const PORT = 3000;

let unreadEmails = []

// IMAP configuration
const imapConfig = {
  user: process.env.EMAIL, // Replace with your email
  password: process.env.PASSWORD, // Replace with your email password
  host: process.env.IMAP_HOST,
  port: 993,
  tls: true,
};

const pop3Config = {
  host: 'seu.servidor.pop3.com', // Substitua pelo host do seu servidor POP3
  port: 995, // Porta padrão para POP3 com SSL
  tls: true, // Usar TLS/SSL
  user: 'seu-email@dominio.com', // Substitua pelo seu e-mail
  password: 'sua-senha' // Substitua pela sua senha
};


console.log(process.env.EMAIL)


// Initialize IMAP connection
const imap = new Imap(imapConfig);

// Function to fetch emails and attachments
function fetchEmails() {
  imap.once('ready', () => {
    imap.openBox('INBOX', false, (err, box) => {
      if (err) throw err;

      // Fetch emails from the inbox
      const searchCriteria = ['UNSEEN']; // Fetch unread emails
      const fetchOptions = { bodies: '', struct: true };

      imap.search(searchCriteria, (err, results) => {
        if (err) throw err;

        const fetch = imap.fetch(results, fetchOptions);

        console.log("FETCH => ", fetch)

        fetch.on('message', (msg) => {
          let email = {};

          msg.on('body', (stream, info) => {
            let buffer = '';
            stream.on('data', (chunk) => {
              buffer += chunk.toString('utf8');
            });
            stream.on('end', () => {
              email.body = buffer;
            });
          });

          msg.on('attributes', (attrs) => {
            email.attributes = attrs;
          });

          msg.on('end', () => {
            const parts = email.attributes.struct;
            parts.forEach((part) => {
              if (part.disposition && part.disposition.type.toUpperCase() === 'ATTACHMENT') {
                const attachment = imap.fetch(email.attributes.uid, {
                  bodies: [part.partID],
                  struct: true,
                });

                attachment.on('message', (msg) => {
                  msg.on('body', (stream, info) => {
                    let attachmentBuffer = '';
                    stream.on('data', (chunk) => {
                      attachmentBuffer += chunk.toString('binary');
                    });
                    stream.on('end', () => {
                      const filePath = path.join(__dirname, part.disposition.params.filename);
                      console.log("filePath", filePath)
                      fs.writeFileSync(filePath, attachmentBuffer, 'binary');

                      // Send attachment to endpoint
                      sendAttachmentToEndpoint(filePath);
                    });
                  });
                });
              }
            });
          });
        });

        fetch.on('end', () => {
          console.log('Finished fetching emails.');
          imap.end();
        });
      });
    });
  });

  imap.once('error', (err) => {
    console.error('IMAP error:', err);
  });

  imap.connect();
}

// Function to fetch unread emails
function fetchUnreadEmails() { 
  imap.once('ready', () => {
    imap.openBox('INBOX', true, (err, box) => {
      if (err) throw err;

      // Search for unread emails
      imap.search(['UNSEEN'], (err, results) => {
        if (err) throw err;

        if (results.length === 0) {
          console.log('No unread emails found.');
          resolve([]);
        }

        // Fetch the unread emails
        const fetch = imap.fetch(results, {
          bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)', 'TEXT'],
          struct: true,
        });

        fetch.on('message', (msg, seqno) => {
          let email = { seqno, headers: null, body: null };

          msg.on('body', (stream, info) => {
            let buffer = '';
            stream.on('data', (chunk) => {
              buffer += chunk.toString('utf8');
            });
            stream.once('end', () => {
              if (info.which === 'HEADER.FIELDS (FROM TO SUBJECT DATE)') {
                email.headers = Imap.parseHeader(buffer);
              } else if (info.which === 'TEXT') {
                email.body = buffer;
              }
            });
          });

          msg.once('end', () => {
            unreadEmails.push(email);
          });
        });

        fetch.once('end', () => {
          imap.end();
          resolve(unreadEmails);
        });
      });
    });
  });

  imap.once('error', (err) => {
    throw err;
  });

  imap.once('end', () => {
    console.log('Connection ended.');
  });

  imap.connect();
}

// Function to send attachment to an endpoint
async function sendAttachmentToEndpoint(filePath) {
  const fileStream = fs.createReadStream(filePath);
  const formData = new FormData();
  formData.append('file', fileStream);

  try {
    const response = await axios.post('http://localhost:3333/upload', formData, {
      headers: {
        ...formData.getHeaders(),
      },

    });
    console.log('Attachment sent successfully:', response.data);
  } catch (error) {
    console.error('Error sending attachment:', error);
  }
}

// API endpoint to trigger email fetching
app.get('/fetch-emails', (req, res) => {
  fetchEmails();
  res.send('Fetching emails...');
});

app.get('/unread-emails', async (req, res) => {
  try {

    console.log("I am here!!!")

    unreadEmails = []; // Reset the variable
    const emails = await fetchUnreadEmails();
    res.json(emails);
  } catch (err) {
    console.error('Error fetching unread emails:', err);
    res.status(500).json({ error: 'Failed to fetch unread emails' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});