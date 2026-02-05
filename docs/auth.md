# Microsoft Entra ID Authentication Configuration

This document describes how to configure Microsoft Entra ID (Azure AD) for single-tenant SSO authentication with group-based authorization.

## Overview

The application uses OpenID Connect (OIDC) Authorization Code flow with PKCE for authentication. Users must:
1. Authenticate with their Microsoft account
2. Be a member of a specific Entra group to access the application

## Prerequisites

- Microsoft Entra ID tenant (Azure AD)
- Permissions to create app registrations
- Administrative access to manage group membership

## Step 1: Create App Registration

1. Go to [Azure Portal](https://portal.azure.com) → Microsoft Entra ID → App registrations
2. Click **New registration**
3. Configure:
   - **Name**: `BROEN-LAB Chat` (or your preferred name)
   - **Supported account types**: "Accounts in this organizational directory only (Single tenant)"
   - **Redirect URI**: 
     - Type: Web
     - URI: `https://<your-container-app-url>/auth/callback`
4. Click **Register**
5. Note the following values:
   - **Application (client) ID** → `ENTRA_CLIENT_ID`
   - **Directory (tenant) ID** → `ENTRA_TENANT_ID`

## Step 2: Create Client Secret

1. In the app registration, go to **Certificates & secrets**
2. Click **New client secret**
3. Add a description and choose expiration period
4. Click **Add**
5. **Copy the secret value immediately** → `ENTRA_CLIENT_SECRET`
   - ⚠️ This value is only shown once!

## Step 3: Configure API Permissions

1. Go to **API permissions**
2. Click **Add a permission**
3. Select **Microsoft Graph** → **Delegated permissions**
4. Add these permissions:
   - `openid`
   - `profile`
   - `email`
5. Click **Grant admin consent** for your organization

## Step 4: Configure Group Claims (Required for Authorization)

### Option A: Emit Group Claims in Token (Recommended)

1. Go to **Token configuration**
2. Click **Add groups claim**
3. Configure:
   - **Select group types**: Security groups (or as appropriate)
   - **Customize token properties by type**:
     - For **ID tokens**: Select "Group ID"
4. Click **Add**

#### Important: Group Overage

If a user is a member of more than 200 groups, Azure will not include group claims in the token due to size limits. Instead, it includes a `_claim_names.groups` indicator.

To avoid this:
- Limit users to fewer than 200 group memberships
- Or filter to specific groups by configuring the app to only emit groups assigned to the application

### Option B: Emit Only Assigned Groups (Prevents Overage)

1. Go to **Enterprise applications** → Find your app
2. Go to **Users and groups**
3. Click **Add user/group**
4. Assign the security group you want to use for authorization
5. In the app registration → **Token configuration**:
   - Edit the groups claim
   - Select "Groups assigned to the application"

## Step 5: Create Authorization Group

1. Go to **Microsoft Entra ID** → **Groups**
2. Click **New group**
3. Configure:
   - **Group type**: Security
   - **Group name**: `BROEN-LAB Users` (or your preferred name)
   - **Membership type**: Assigned
4. Click **Create**
5. Note the **Object ID** → `ENTRA_ALLOWED_GROUP_ID`
6. Add users who should have access to the application

## Step 6: Configure Redirect URIs

Ensure your app registration has the correct redirect URIs:

1. Go to **Authentication**
2. Under **Platform configurations** → Web:
   - Redirect URIs: `https://<your-container-app-url>/auth/callback`
   - Front-channel logout URL: `https://<your-container-app-url>/` (optional)
3. Under **Advanced settings**:
   - Allow public client flows: No

## Environment Variables

Set these environment variables in your deployment:

```bash
# Required for Entra authentication
ENTRA_TENANT_ID=<your-tenant-id>
ENTRA_CLIENT_ID=<your-client-id>
ENTRA_CLIENT_SECRET=<your-client-secret>
ENTRA_ALLOWED_GROUP_ID=<your-group-object-id>

# Optional (defaults shown)
ENTRA_REDIRECT_PATH=/auth/callback
ENTRA_POST_LOGOUT_REDIRECT_PATH=/
```

## Troubleshooting

### "Group membership could not be verified"

**Cause**: The token does not contain group claims.

**Solutions**:
1. Verify group claims are configured in Token Configuration
2. Ensure admin consent was granted
3. Check if user has more than 200 group memberships (overage)

### "Invalid state parameter"

**Cause**: Session was lost between login initiation and callback.

**Solutions**:
1. Ensure Redis is running and connected
2. Check SESSION_SECRET is consistent across instances
3. Verify cookies are being sent (check SameSite and Secure settings)

### "Access Denied" after successful login

**Cause**: User is not a member of the allowed group.

**Solutions**:
1. Add the user to the group specified in `ENTRA_ALLOWED_GROUP_ID`
2. Wait a few minutes for group membership to propagate
3. Have the user sign out and sign in again

### Login redirect loop

**Cause**: Callback failing silently or session not persisting.

**Solutions**:
1. Check application logs for callback errors
2. Verify REDIS_URL is correct and Redis is accessible
3. Ensure BASE_URL matches the actual app URL

## Security Best Practices

1. **Rotate client secrets** before expiration
2. **Use short session durations** in production
3. **Monitor sign-in logs** in Entra ID for anomalies
4. **Enable MFA** for users in the allowed group
5. **Use Conditional Access policies** for additional security
