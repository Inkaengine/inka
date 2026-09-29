# Security policy

Inka is open source under the MIT licence. We take security reports seriously and fix them to published timescales.

## Supported versions

| Version | Security fixes |
|---|---|
| Latest release | Yes |
| Previous minor release | Yes, for 6 months after the next minor release |
| Older releases | No. Upgrade to a supported release |

Organisations with a security and maintenance subscription get security fixes on the version they run (see below).

## Reporting a vulnerability

Please report vulnerabilities privately. Do not open a public issue.

- Use GitHub's private vulnerability reporting: the **Security** tab of this repository, then **Report a vulnerability**.
- Or email security@pretagov.com.

Include what is affected (the editor, the bridge script, an adapter), the version, steps to reproduce, and the impact as you see it. If you have a proof of concept, include it.

We will:

- acknowledge your report within 3 working days;
- give an initial assessment, including severity, within 7 days;
- keep you informed until it is fixed, and credit you in the advisory unless you ask us not to.

## Fix timescales

| Severity | Fix released |
|---|---|
| Actively exploited | Within 72 hours |
| Critical or high | Within 14 days |
| Medium or low | In the next scheduled release |

Severity follows CVSS. Fixes are published as GitHub Security Advisories, with a CVE where appropriate. Organisations with a security and maintenance subscription are told before the advisory is public.

## Scope

In scope: the Inka editor, the bridge script used by front ends, and the CMS adapters in this repository.

Out of scope, and where to report instead:

- **Volto and Plone.** Inka's editing application is built on Volto, the Plone project's React editing interface. Vulnerabilities in Volto or Plone should go to the Plone Security Team at security@plone.org. We ship Volto security releases in Inka within the timescales above.
- **Your CMS.** Vulnerabilities in Drupal, WordPress, Plone or another CMS should go to that project's security team.
- **Your site.** Front ends and hosting configured by others.

## Dependencies

Dependencies are monitored automatically, and security updates are applied within the same timescales. A software bill of materials is available on request.

## Security and maintenance subscription

PretaGov, which develops Inka, offers a security and maintenance subscription: security fixes on the version you run, advance notice of security releases, dependencies kept current, and monthly reporting. Contact security@pretagov.com.
