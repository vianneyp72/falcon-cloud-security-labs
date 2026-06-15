FROM python:3.12-slim

WORKDIR /app

# Fix ZScaler MITM proxy SSL interception
COPY zscaler-root-ca.pem /usr/local/share/ca-certificates/zscaler.crt
RUN update-ca-certificates
ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
ENV REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt

COPY requirements.txt .
RUN pip install --no-cache-dir \
    --index-url https://artifactory.cicd.dc/artifactory/api/pypi/pypi-prod-virtual/simple \
    --trusted-host artifactory.cicd.dc \
    -r requirements.txt

COPY app.py .

EXPOSE 5000

CMD ["python", "app.py"]
