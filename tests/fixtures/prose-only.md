A **hard link** is a second directory entry for the same inode; a *symlink* is a tiny file that stores a path.
   
Delete the original and the hard link still works — the symlink dangles. Hard links can't cross filesystems or (normally) point at directories.
