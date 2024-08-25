function generatePairingCode() {
    const phoneNumber = document.getElementById('phoneNumber').value;
    
    if (!phoneNumber) {
        alert('Please enter a WhatsApp number.');
        return;
    }

    fetch('/generate-pairing-code', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ phoneNumber: phoneNumber }),
    })
    .then(response => response.json())
    .then(data => {
        if (data.pairingCode) {
            document.getElementById('output').textContent = `Pairing Code: ${data.pairingCode}`;
        } else {
            document.getElementById('output').textContent = 'Error generating pairing code';
        }
    })
    .catch(error => {
        console.error('Error:', error);
        document.getElementById('output').textContent = 'Error generating pairing code';
    });
}
