class Brrr < Formula
  desc "Webhook notifications for Claude Code and Codex"
  homepage "https://github.com/simonbs/brrr-cli"
  url "https://github.com/simonbs/brrr-cli/archive/refs/tags/v0.1.5.tar.gz"
  sha256 "67af659afb2877c3ac568a22b2a6ddec6a414e1d2d9ca6ea88a6661ff2277e2b"
  head "https://github.com/simonbs/brrr-cli.git", branch: "main"

  depends_on "node"

  def install
    system "npm", "ci"
    system "npm", "run", "build"
    system "npm", "prune", "--omit=dev"

    libexec.install Dir["*"]
    bin.install_symlink libexec/"dist/src/cli.js" => "brrr"
  end

  test do
    assert_match "Usage: brrr", shell_output("#{bin}/brrr --help")
  end
end
