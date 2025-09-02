// renderer/scripts/github-api.js

const githubAPI = {
    async fetchRepoData(repoUrl) {
        const apiUrl = this.parseRepoUrl(repoUrl);
        if (!apiUrl) {
            return { error: 'Invalid GitHub Repository URL' };
        }

        try {
            // Fetch repository details and releases in parallel
            const [repoRes, releasesRes] = await Promise.all([
                fetch(`https://api.github.com/repos/${apiUrl.owner}/${apiUrl.repo}`),
                fetch(`https://api.github.com/repos/${apiUrl.owner}/${apiUrl.repo}/releases`)
            ]);

            if (!repoRes.ok) {
                return { error: `Repository not found or API limit exceeded. Status: ${repoRes.status}` };
            }
            if (!releasesRes.ok) {
                return { error: `Could not fetch releases. Status: ${releasesRes.status}` };
            }

            const repoData = await repoRes.json();
            const releasesData = await releasesRes.json();

            return {
                repo: {
                    name: repoData.name,
                    description: repoData.description,
                    stars: repoData.stargazers_count,
                    forks: repoData.forks_count,
                    avatarUrl: repoData.owner.avatar_url
                },
                releases: releasesData.filter(release => !release.draft && release.assets.some(a => a.name.endsWith('.deb')))
            };

        } catch (error) {
            console.error('GitHub API fetch error:', error);
            return { error: 'Network error or invalid response from GitHub API.' };
        }
    },

    parseRepoUrl(url) {
        try {
            // Handle full URLs
            if (url.startsWith('http')) {
                const path = new URL(url).pathname;
                const parts = path.split('/').filter(p => p);
                if (parts.length >= 2) {
                    return { owner: parts[0], repo: parts[1] };
                }
            } else { // Handle "owner/repo" format
                const parts = url.split('/').filter(p => p);
                if (parts.length >= 2) {
                    return { owner: parts[0], repo: parts[1] };
                }
            }
            return null;
        } catch (error) {
            return null; // Invalid URL
        }
    }
};