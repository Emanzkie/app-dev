// Server-Sent Events client registry and broadcaster.
const clients = new Set();

function removeClient(res) {
    clients.delete(res);
}

function addClient(res) {
    clients.add(res);

    res.once('close', () => removeClient(res));
    res.once('error', () => removeClient(res));
}

function broadcast(event, data) {
    const payload = `event: ${String(event)}\ndata: ${JSON.stringify(data)}\n\n`;

    for (const client of Array.from(clients)) {
        if (client.destroyed || client.writableEnded) {
            removeClient(client);
            continue;
        }

        try {
            client.write(payload, (err) => {
                if (err) {
                    removeClient(client);
                }
            });
        } catch (err) {
            removeClient(client);
        }
    }
}

module.exports = {
    addClient,
    removeClient,
    broadcast,
};
