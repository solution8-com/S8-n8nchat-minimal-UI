# Azure Deployment Guide

This document describes how to deploy the BROEN-LAB Chat application to Azure Container Apps using GitHub Actions CI/CD.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    GitHub Repository                         │
│                         │                                    │
│                    Push to main                              │
│                         ▼                                    │
│               GitHub Actions Workflow                        │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                 Azure Container Registry                     │
│               (broenlab-acr.azurecr.io)                     │
│                         │                                    │
│                    Docker Image                              │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              Azure Container Apps Environment                │
│                    (broenlab-env)                           │
│                         │                                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │          Container App: broenlab-chat                │   │
│  │              (HTTPS Ingress)                         │   │
│  └─────────────────────────────────────────────────────┘   │
│                         │                                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │          Azure Cache for Redis                       │   │
│  │              (Session Store)                         │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Prerequisites

- Azure subscription
- Azure CLI installed locally
- GitHub repository with admin access

## One-Time Azure Setup

### 1. Create Resource Group (if not exists)

```bash
az group create \
  --name CHABANA \
  --location westeurope
```

### 2. Create Azure Container Registry

```bash
az acr create \
  --name broenlab \
  --resource-group CHABANA \
  --location westeurope \
  --sku Basic \
  --admin-enabled true
```

Note the login server: `broenlab.azurecr.io`

### 3. Create Container Apps Environment

```bash
az containerapp env create \
  --name broenlab-env \
  --resource-group CHABANA \
  --location westeurope
```

### 4. Create Azure Cache for Redis

```bash
az redis create \
  --name broenlab-redis \
  --resource-group CHABANA \
  --location westeurope \
  --sku Basic \
  --vm-size c0
```

Get the connection string:
```bash
az redis show \
  --name broenlab-redis \
  --resource-group CHABANA \
  --query "hostName" \
  --output tsv

az redis list-keys \
  --name broenlab-redis \
  --resource-group CHABANA \
  --query "primaryKey" \
  --output tsv
```

Format the REDIS_URL: `rediss://:PASSWORD@HOSTNAME:6380`

### 5. Create Service Principal for GitHub Actions

#### Option A: Workload Identity Federation (Recommended)

1. Create a user-assigned managed identity:
```bash
az identity create \
  --name github-actions-identity \
  --resource-group CHABANA \
  --location westeurope
```

2. Get the identity details:
```bash
az identity show \
  --name github-actions-identity \
  --resource-group CHABANA \
  --query "{clientId: clientId, principalId: principalId}" \
  --output json
```

3. Create federated credential:
```bash
az identity federated-credential create \
  --name github-main-branch \
  --identity-name github-actions-identity \
  --resource-group CHABANA \
  --issuer https://token.actions.githubusercontent.com \
  --subject repo:solution8-com/S8-n8nchat-minimal-UI:ref:refs/heads/main \
  --audiences api://AzureADTokenExchange
```

4. Grant permissions to the identity:
```bash
# Get subscription ID
SUBSCRIPTION_ID=$(az account show --query id --output tsv)

# Get principal ID
PRINCIPAL_ID=$(az identity show --name github-actions-identity --resource-group CHABANA --query principalId --output tsv)

# Assign Contributor role to resource group
az role assignment create \
  --role Contributor \
  --assignee-object-id $PRINCIPAL_ID \
  --assignee-principal-type ServicePrincipal \
  --scope /subscriptions/$SUBSCRIPTION_ID/resourceGroups/CHABANA

# Assign AcrPush role to container registry
az role assignment create \
  --role AcrPush \
  --assignee-object-id $PRINCIPAL_ID \
  --assignee-principal-type ServicePrincipal \
  --scope /subscriptions/$SUBSCRIPTION_ID/resourceGroups/CHABANA/providers/Microsoft.ContainerRegistry/registries/broenlab
```

#### Option B: Service Principal with Secret

```bash
az ad sp create-for-rbac \
  --name "github-actions-broenlab" \
  --role Contributor \
  --scopes /subscriptions/{subscription-id}/resourceGroups/CHABANA \
  --json-auth
```

## GitHub Secrets Configuration

Configure these secrets in your GitHub repository (Settings → Secrets and variables → Actions):

### Azure Authentication (Workload Identity Federation)
| Secret | Description |
|--------|-------------|
| `AZURE_CLIENT_ID` | User-assigned managed identity client ID |
| `AZURE_TENANT_ID` | Azure AD tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID |

### Azure Resources
| Secret | Description |
|--------|-------------|
| `ACR_NAME` | Container registry name (e.g., `broenlab`) |

### Application Configuration
| Secret | Description | Example |
|--------|-------------|---------|
| `BASE_URL` | Public URL of the app | `https://broenlab-chat.westeurope.azurecontainerapps.io` |
| `SESSION_SECRET` | Random 32+ character string | Generate with `openssl rand -base64 32` |
| `REDIS_URL` | Azure Redis connection string | `rediss://:PASSWORD@host:6380` |

### Entra ID Configuration
| Secret | Description |
|--------|-------------|
| `ENTRA_TENANT_ID` | Microsoft Entra tenant ID |
| `ENTRA_CLIENT_ID` | App registration client ID |
| `ENTRA_CLIENT_SECRET` | App registration client secret |
| `ENTRA_ALLOWED_GROUP_ID` | Security group Object ID |

### N8N Webhook Configuration
| Secret | Description |
|--------|-------------|
| `N8N_WEBHOOK_URL` | Production webhook URL |
| `N8N_USERNAME` | N8N basic auth username |
| `N8N_PASSWORD` | N8N basic auth password |

## Deployment Process

### Initial Deployment

1. Configure all GitHub secrets
2. Push to the `main` branch
3. GitHub Actions will:
   - Build the Docker image
   - Push to Azure Container Registry
   - Create/update the Container App
   - Configure environment variables and secrets

### Subsequent Deployments

Push to `main` branch triggers automatic deployment. The workflow will update the container image while preserving secrets and configuration.

### Manual Deployment

Trigger manually via GitHub Actions → "Build and Deploy to Azure Container Apps" → "Run workflow"

## Verifying Deployment

### Check Container App Status

```bash
az containerapp show \
  --name broenlab-chat \
  --resource-group CHABANA \
  --query "{state: properties.runningStatus, url: properties.configuration.ingress.fqdn}"
```

### View Logs

```bash
az containerapp logs show \
  --name broenlab-chat \
  --resource-group CHABANA \
  --follow
```

### Health Endpoints

- **Liveness**: `https://<app-url>/healthz`
- **Readiness**: `https://<app-url>/readyz`

## Scaling Configuration

Default configuration:
- Minimum replicas: 1
- Maximum replicas: 3
- CPU: 0.5 cores
- Memory: 1GB

Modify scaling:
```bash
az containerapp update \
  --name broenlab-chat \
  --resource-group CHABANA \
  --min-replicas 2 \
  --max-replicas 5
```

## Troubleshooting

### Container App not starting

1. Check logs:
```bash
az containerapp logs show --name broenlab-chat --resource-group CHABANA
```

2. Verify secrets are configured:
```bash
az containerapp show --name broenlab-chat --resource-group CHABANA --query "properties.template.containers[0].env"
```

### Authentication failures

1. Verify Entra app redirect URI matches the Container App URL
2. Check that BASE_URL secret matches the actual app URL
3. Ensure Redis is accessible from the Container App

### Redis connection issues

1. Verify Redis firewall allows Container Apps:
```bash
az redis firewall-rules list --name broenlab-redis --resource-group CHABANA
```

2. Check Redis connection string format (must use `rediss://` for SSL)

## Cost Optimization

- Use consumption plan for Container Apps (pay per use)
- Consider Basic tier for Redis in non-production
- Scale down min-replicas during off-hours if acceptable
