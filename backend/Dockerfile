FROM python:3.13-slim-bullseye

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# System deps: libpq (Postgres), curl (health), and the Pango/Cairo stack
# required by WeasyPrint for PDF generation. (MySQL is not used.)
RUN apt-get update && apt-get install -y \
    libpq-dev \
    gcc \
    curl \
    pkg-config \
    build-essential \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libgdk-pixbuf2.0-0 \
    libffi-dev \
    libcairo2 \
    libjpeg-dev \
    libpng-dev \
    fonts-liberation \
    fonts-freefont-ttf \
    libxml2 \
    libxslt1.1 \
    libfontconfig1 \
    shared-mime-info \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./

RUN pip install --upgrade pip && pip install -r requirements.txt
# openai/anthropic/pgvector aren't in the hash-pinned requirements export, so
# install them separately (a single hashed entry would force --require-hashes on
# all of requirements.txt). Without this, every AI call fails: "No module named 'openai'".
RUN pip install --no-cache-dir "openai>=2,<3" "anthropic>=0.40,<1.0" "pgvector>=0.3,<1.0" "sentry-sdk>=2,<3" "pypdf>=5,<6" "reportlab>=4.4,<5"

COPY . .

EXPOSE 8000

# Migrations are a hard startup gate; the supervisor stops the container if a
# required service exits, allowing the orchestrator to restart it.
CMD ["bash", "scripts/start.sh"]
