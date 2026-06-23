# Django + DRF + Templates Architecture Guide

This document explains how to build a reusable Django architecture that combines server-rendered templates with Django REST Framework APIs:

- Django serves HTML pages and static assets.
- Django REST Framework exposes business data through `/api/...` endpoints.
- The browser renders pages from Django templates, but interactive data loading and mutations happen through DRF endpoints.
- Frontend code should treat the template as the application shell, not the primary data source.

Use it as an implementation contract for AI agents or developers building new Django applications.

## 1. Architecture Goal

Use one Django codebase for both:

- server-rendered page delivery
- REST API delivery

The separation of responsibilities should be strict:

- `dashboard/` or similar UI routes return templates.
- `/api/` routes return JSON.
- Templates provide layout, navigation, placeholders, and a small amount of bootstrapping metadata.
- All UI data retrieval should be requested from DRF endpoints.

That means:

- do not render tables, charts, lists, or detail records from large Django template contexts
- do not duplicate business logic in template views
- do not let templates bypass the API layer for interactive pages

The UI should fetch data from DRF even when the page itself is served by Django.

## 2. Recommended Project Shape

Use a modular Django monolith with a dedicated UI layer and separate domain modules.

```text
project_root/
  project_config/
    settings.py
    urls.py
    wsgi.py
    asgi.py
  ui/
    urls.py
    views.py
    templates/
    static/
    middleware.py
    context_processors.py
  domain_a/
    models.py
    serializers.py
    views.py
    urls.py
  domain_b/
    models.py
    serializers.py
    views.py
    urls.py
  shared/
```

### Why this structure works

- the UI module owns the page shell and frontend assets.
- domain modules own models, serializers, API rules, and business workflows.
- the root URL configuration composes template routes and API routes in one place.

## 3. Routing Pattern

Use a pattern like this:

```python
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),

    # Template UI
    path("dashboard/", include("ui.urls")),

    # JSON API
    path("api/domain-a/", include("domain_a.urls")),
    path("api/domain-b/", include("domain_b.urls")),
]
```

This gives you a clean contract:

- `/dashboard/...` returns HTML
- `/api/...` returns JSON

## 4. Responsibility Split

### Template views

Template views should stay thin.

Good uses of template views:

- render layout pages
- enforce authentication
- pass page title, breadcrumbs, route names, and small configuration values
- provide element IDs or `data-*` attributes that frontend JavaScript can use

Avoid doing this in template views for interactive screens:

- fetching full table datasets
- applying reporting filters
- computing chart series for client-side charts
- joining unrelated domain data just for UI convenience

Instead, move that work into DRF endpoints.

### DRF views/viewsets

DRF should be the single source of truth for:

- list data
- detail data
- filters
- search
- pagination
- create/update/delete actions
- workflow actions such as posting, approval, reconciliation, export preparation, or status changes

Use routers for standard resource endpoints and dedicated API views for workflow-specific actions.

## 5. Frontend Request Model

The browser flow should work like this:

1. User visits a Django page such as `/dashboard/resources/`.
2. Django returns HTML, CSS, and JavaScript.
3. After page load, JavaScript calls DRF endpoints such as `/api/resources/`.
4. The API returns paginated JSON.
5. JavaScript updates tables, charts, filters, forms, and counters.

This is the core design rule:

> The template delivers the screen container. The API delivers the screen data.

## 6. Example Request Flow

For a typical resource page, the interaction should look like this:

```text
GET  /dashboard/resources/             -> returns HTML page
GET  /api/related-options/?page_size=500 -> returns filter or select options
GET  /api/resources/?page=1            -> returns table rows
POST /api/resources/                   -> creates a new record
PATCH /api/resources/42/               -> updates an existing record
```

This pattern keeps the UI thin and makes the API the source of truth for page data.

## 7. Authentication Model

For a project like this, use cookie-based authentication for browser requests.

Recommended pattern:

- login endpoint validates credentials
- backend sets `httpOnly` auth cookies
- browser sends cookies automatically on same-origin requests
- JavaScript includes CSRF token for unsafe methods

This avoids storing access tokens in `localStorage` and works well when Django serves both the UI and the API from the same origin.

### Practical browser flow

1. User submits login form.
2. Django login view or DRF auth endpoint validates credentials.
3. Backend sets cookies.
4. Frontend redirects to a template page.
5. All subsequent `fetch()` requests include cookies automatically.

For unsafe HTTP methods, include CSRF headers:

```js
async function request(url, options = {}) {
  const defaults = {
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': csrfToken(),
      ...(options.headers || {}),
    },
  };

  const response = await fetch(url, {
    ...defaults,
    ...options,
    headers: defaults.headers,
  });

  return response;
}
```

## 8. Recommended Backend Setup

### Core packages

For a similar project, start with:

- `django`
- `djangorestframework`
- `django-filter`
- `djangorestframework-simplejwt`
- `drf-yasg` or `drf-spectacular`
- `django-cors-headers` if frontend and backend are split across origins
- `pillow` if image uploads are needed
- `python-dotenv` for environment configuration
- `gunicorn` and `daphne` if you want both WSGI and ASGI support

Optional additions depend on your workload:

- `celery` and `django-celery-beat` for background jobs
- `channels` and `channels-redis` for websockets
- `pandas`, `xlsxwriter`, `weasyprint`, `python-docx` for reporting/export features

### DRF settings principles

Recommended DRF defaults:

```python
REST_FRAMEWORK = {
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 25,
}
```

If using JWT cookies with browser pages, also make sure your middleware and CSRF settings are coherent for same-origin traffic.

## 9. Recommended App Conventions

Inside each domain module, keep the same vertical slice:

- `models.py` for persistence
- `serializers.py` for API contracts
- `views.py` for viewsets and workflow endpoints
- `urls.py` for routers and extra actions
- `tests.py` for API behavior

Typical DRF pattern:

```python
from rest_framework import viewsets
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter

class ResourceViewSet(viewsets.ModelViewSet):
    queryset = Resource.objects.all()
    serializer_class = ResourceSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["status", "category"]
    search_fields = ["code", "name", "description"]
    ordering_fields = ["created_at", "name"]
```

This is what allows the frontend to request data without hardcoding business logic into templates.

## 10. How Frontend Requests Should Be Sent

Use one shared JavaScript request utility for the whole UI.

It should handle:

- JSON headers
- CSRF token injection
- credentials/cookies
- uniform error handling
- query string building

Example:

```js
const ApiClient = {
  get(url, params = {}) {
    const qs = new URLSearchParams(params).toString();
    return request(`${url}${qs ? '?' + qs : ''}`);
  },

  post(url, body) {
    return request(url, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  patch(url, body) {
    return request(url, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  del(url) {
    return request(url, { method: 'DELETE' });
  },
};
```

Then page scripts should call API endpoints directly:

```js
async function loadResources(page = 1) {
  const response = await ApiClient.get('/api/resources/', {
    page,
    page_size: 25,
    search: document.getElementById('resourceSearch').value.trim(),
  });

  if (!response.ok) {
    showToast('Failed to load resources');
    return;
  }

  const payload = response.data;
  renderResources(payload.results || payload);
}
```

## 11. Template Strategy

Your templates should mostly contain:

- page structure
- reusable blocks and includes
- empty table bodies
- filter inputs
- modals
- chart containers
- links to static JavaScript files

Example skeleton:

```html
{% extends "base.html" %}

{% block content %}
<section>
  <h1>Resources</h1>

  <input id="resourceSearch" type="search" placeholder="Search resources">

  <table>
    <thead>
      <tr>
        <th>Code</th>
        <th>Name</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody id="resourcesTableBody"></tbody>
  </table>
</section>
{% endblock %}

{% block extra_js %}
<script src="{% static 'js/api-client.js' %}"></script>
<script src="{% static 'js/resources.js' %}"></script>
{% endblock %}
```

The template should not render full resource data directly unless the page is intentionally static.

## 12. What to Pass from Django View to Template

For interactive pages, keep template context minimal.

Pass values like:

- `page_title`
- `breadcrumbs`
- `active_nav_key`
- small constants such as feature flags
- URLs or route names if you want the template to expose them in `data-*` attributes

Do not pass:

- large querysets
- full report payloads
- repeated aggregates that the API already exposes

Good example:

```python
def resource_list_view(request):
    return render(request, "resources/list.html", {
        "page_title": "Resources",
        "active_nav_key": "resources",
    })
```

## 13. Pagination, Filtering, and Search

Put these on the API, not in templates.

Every list endpoint should support as needed:

- `page`
- `page_size`
- `search`
- `ordering`
- filter fields such as `status`, `category`, `date_from`, `date_to`

Example frontend request:

```js
ApiClient.get('/api/resources/', {
  page: 1,
  page_size: 25,
  search: 'example',
  status: 'active',
  category: 'default',
  date_from: '2026-01-01',
  date_to: '2026-01-31',
});
```

This keeps pagination and filtering consistent whether the client is a template page, mobile app, or external integration.

## 14. Reporting Pages

For analytics pages, KPI pages, and reports, use the same rule:

- page shell from Django
- data from DRF

Two practical options:

### Option A: General list endpoints

Use existing list endpoints and compute lightweight UI metrics in JavaScript.

Use this when:

- datasets are small enough
- the page is mostly presentational

### Option B: dedicated report endpoints

Create endpoints such as:

- `/api/reports/summary/`
- `/api/reports/portfolio/`
- `/api/reports/overview/`

Use this when:

- aggregation is expensive
- filters are complex
- the result should be reusable across UI and exports

For serious business reporting, Option B is usually better.

## 15. Recommended Setup Steps For a New Similar Project

1. Create the Django project and domain modules.
2. Install Django, DRF, `django-filter`, auth packages, and documentation packages.
3. Create one UI module for template pages and frontend assets.
4. Define a root URL split between `/dashboard/` and `/api/`.
5. Build models in domain modules.
6. Add serializers and DRF viewsets in each domain module.
7. Register routers in each module's `urls.py`.
8. Add a shared frontend request helper for `fetch()`.
9. Build templates as shells only.
10. Load page data from DRF on `DOMContentLoaded`.
11. Add pagination, filters, and search to DRF endpoints.
12. Add auth with cookies and CSRF for browser safety.
13. Document endpoints with Swagger or Spectacular.
14. Add API tests before expanding the UI.

## 16. Example Build Order

If you are starting from scratch, build in this order:

### Phase 1: foundations

- project settings
- user model and authentication
- shared base template
- API documentation

### Phase 2: first vertical slice

- one domain model
- matching serializer
- matching DRF viewset
- one `/dashboard/...` page shell
- one page script that loads data from `/api/...`

### Phase 3: reusable frontend infrastructure

- AJAX helper
- toast/messages helper
- pagination renderer
- search-select component
- chart helpers

### Phase 4: more modules

- additional domain areas
- reports
- integrations
- background workflows

This keeps architecture consistent while the project grows.

## 17. Anti-Patterns To Avoid

Avoid these if you want a maintainable mixed Django + DRF system:

- rendering large datasets directly in templates and also exposing the same data in APIs
- letting page-specific template views become mini service layers
- mixing direct ORM queries in JavaScript-driven page views with DRF queries for the same screen
- storing auth tokens in `localStorage` when same-origin cookie auth is available
- creating endpoints that are shaped around one template instead of business resources
- skipping pagination on list endpoints used by the UI

## 18. Suggested Standard For Your New Project

If your requirement is strict that all UI retrieval comes from APIs, use this standard:

- Django templates render only layout and placeholders.
- All page data is loaded with `fetch()` from DRF endpoints.
- All create/update/delete actions are sent to DRF endpoints.
- Template views do not fetch business datasets except tiny bootstrapping values.
- Shared request utilities manage CSRF, cookies, and error handling.
- DRF endpoints own filtering, search, pagination, validation, and serialization.

That gives you:

- one backend stack
- one authentication model
- reusable APIs
- cleaner frontend evolution
- less duplication between UI and business logic

## 19. Final Recommendation

For a similar project, keep Django templates because they are useful for:

- server-rendered navigation
- authentication pages
- layout composition
- shared asset loading
- progressive enhancement

But treat DRF as the real data boundary.

That is the cleanest way to combine templating and REST Framework in one Django project.
