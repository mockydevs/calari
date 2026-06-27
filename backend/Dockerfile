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
RUN pip install --no-cache-dir "openai>=2,<3" "anthropic>=0.40,<1.0" "pgvector>=0.3,<1.0" "sentry-sdk>=2,<3"

COPY . .

EXPOSE 8000

# Apply migrations (blocking — schema must exist before serving), then start
# Daphne immediately. The Build Library seed is idempotent data population, not a
# readiness requirement, so it runs in the BACKGROUND off the boot path — keeping
# it inline delayed Daphne and slowed every deploy's readiness. Celery worker +
# beat run in the background; Daphne (Channels websockets) is the foreground PID 1.
CMD bash -c "python manage.py migrate --noinput && python manage.py migrate vectorstore --database=vectors --noinput || true; (python manage.py seed_build_library || true &); (celery -A config worker --loglevel=info &) && (celery -A config beat --loglevel=info --scheduler django_celery_beat.schedulers:DatabaseScheduler &) && daphne -b 0.0.0.0 -p 8000 config.asgi:application"
